import { useMemo, useState } from "preact/hooks";
import { hasMessage, type Lang, type Localized, type MessageKey, pick, t } from "../../i18n/index.ts";
import { riddleEndingKey } from "../eggs.ts";
import { diffWords, previousTelling, type Run } from "../ending-diff.ts";
import { buildForest, type EndingView, type Epilogue as EpilogueLine, type Layout, layoutForest, type MyTelling, nodeWords, type RevealChain, type Telling, TREE, versionWords, wrapText } from "../ending.ts";
import type { MomentCard } from "../moments.ts";
import type { Name, Scene } from "../scene.ts";
import { numberWord, ordinal } from "./format.ts";
import { MomentsRow } from "./moments.tsx";
import { count } from "./paper-text.ts";
import { InkAct, Tick } from "./ink.tsx";

/**
 * A text the core names in both languages. The core's text in the language of the page is what is
 * shown. Only a label that has nothing in that language (a label that came as one string, or an
 * ending known by its id alone) falls back to the page's own text under
 * `key`, and then to the other language of the core.
 */
function said(name: Name | null, lang: Lang, key: string): string {
  const direct = name === null ? "" : name[lang];
  if (direct !== "") return direct;
  if (hasMessage(key)) return t(key);
  return name === null ? "" : pick(name as Localized, lang);
}

function nameFor(scene: Scene | null, id: string, lang: Lang): string {
  const person = scene?.cast.find((p) => p.id === id);
  if (person !== undefined) return pick(person.name, lang);
  // The manager is in the record too, as the one who told someone.
  return scene?.player?.id === id ? pick(scene.player.name, lang) : id;
}

/** Where a line turns up or down: in the middle of the gap between the column of the one who told and the column of the one who was told. */
const jointOf = (to: { x: number }): number => to.x - TREE.gap / 2;

/**
 * The line from a person to the one they told: out of the right side of the name along its row, up or down the gap between the two columns (which holds
 * no words), and into the left side of the other name. Only the names stand on a row and the words hang under them inside their own column, so the line
 * passes over no words.
 */
const edgePath = (from: { x: number; y: number; w: number }, to: { x: number; y: number }): string => {
  const x1 = from.x + from.w;
  const y1 = from.y + TREE.height / 2;
  const x2 = to.x;
  const y2 = to.y + TREE.height / 2;
  if (y1 === y2) return `M${x1} ${y1} H${x2}`;
  const joint = jointOf(to);
  const bend = Math.min(8, Math.abs(y2 - y1) / 2);
  const way = y2 > y1 ? 1 : -1;
  return `M${x1} ${y1} H${joint - bend} Q${joint} ${y1} ${joint} ${y1 + way * bend} V${y2 - way * bend} Q${joint} ${y2} ${joint + bend} ${y2} H${x2}`;
};

/** One story as a tree: a person is a name in a frame, a line is one telling, and a numbered circle is where the story changed. A line can be chosen, to see what it changed. */
function ChainTree({ chain, layout, numbers, scene, lang, picked, onPick }: { chain: RevealChain; layout: Layout; numbers: ReadonlyMap<string, number>; scene: Scene | null; lang: Lang; picked: string | null; onPick(id: string): void }) {
  const trueVersions = new Set(chain.trueVersions);
  return (
    <div class="tree-wrap">
      <svg class="tree" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label={t("ending.chains.title")} data-testid="tree">
        {layout.edges.map((edge) => {
          const changed = edge.telling.op !== "";
          const untrue = chain.trueVersions.length > 0 && !trueVersions.has(edge.telling.prop);
          const flag = numbers.get(edge.telling.id) ?? 0;
          // The number of a telling that changed the story sits where the line turns into the name of the one who was told.
          const x = jointOf(edge.to);
          const y = edge.to.y + TREE.height / 2;
          return (
            <g
              key={edge.telling.id}
              class={`tree-hop${picked === edge.telling.id ? " is-picked" : ""}`}
              data-testid="tree-edge"
              data-changed={changed}
              data-untrue={untrue}
              data-picked={picked === edge.telling.id}
              data-id={edge.telling.id}
              data-from={edge.telling.from}
              data-to={edge.telling.to}
              role="button"
              tabindex={0}
              aria-pressed={picked === edge.telling.id}
              aria-label={t("ending.diff.pick", { from: nameFor(scene, edge.telling.from, lang), to: nameFor(scene, edge.telling.to, lang) })}
              onClick={() => onPick(edge.telling.id)}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onPick(edge.telling.id);
              }}
            >
              <path class="tree-edge-hit" d={edgePath(edge.from, edge.to)} fill="none" />
              <path class={`tree-edge${untrue ? " is-untrue" : ""}${changed ? " is-changed" : ""}`} d={edgePath(edge.from, edge.to)} fill="none" />
              {changed ? (
                <g class="tree-flag" data-testid="tree-flag" transform={`translate(${x} ${y})`}>
                  <circle r="8.5" />
                  <text text-anchor="middle" dy="3.6">
                    {flag}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((placed) => {
          const first = placed.node.heard === null;
          const name = nameFor(scene, placed.node.person, lang);
          // Under the name: what this person said, or what they were told if they told nobody.
          const spoken = nodeWords(placed.node);
          const words = spoken === null ? "" : versionWords(chain, spoken.prop, lang);
          const title = [name, first ? t("ending.chain.firsthand") : "", words === "" || spoken === null ? "" : t(spoken.said ? "ending.tree.said" : "ending.tree.heard", { words: quote(chain, spoken.prop, lang) })].filter((part) => part !== "");
          return (
            <g key={placed.node.person} class={`tree-node${first ? " is-first" : ""}`} data-testid="tree-node" data-person={placed.node.person} transform={`translate(${placed.x} ${placed.y})`}>
              <title>{title.join(lang === "zh" ? "，" : ", ")}</title>
              <rect width={placed.w} height={TREE.height} />
              <text x={placed.w / 2} y={TREE.height / 2} text-anchor="middle" dy="4.4">
                {name}
              </text>
              {words === "" || spoken === null ? null : (
                <text class={`tree-words${spoken.said ? "" : " is-heard"}`} data-testid="tree-words" data-said={spoken.said} data-prop={spoken.prop} data-words={words} y={TREE.height + TREE.line}>
                  {wrapText(words, placed.col, TREE.size, TREE.lines).map((line, i) => (
                    <tspan key={i} x={2} dy={i === 0 ? 0 : TREE.line}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The words of a version of a story in a language, as runs that say which of them changed. */
function Runs({ runs, testid }: { runs: readonly Run[]; testid: string }) {
  return (
    <span class="tree-diff-text" data-testid={testid}>
      {runs.map((run, i) => (run.changed ? <mark key={i} class="tree-diff-mark" data-testid="diff-mark">{run.text}</mark> : <span key={i}>{run.text}</span>))}
    </span>
  );
}

/** What the chosen telling changed: the telling before it and this one, with the words that are new in this one marked (characters in Chinese, words in English). */
function TellingDiff({ chain, telling, nameOf, lang }: { chain: RevealChain; telling: Telling | null; nameOf(id: string): string; lang: Lang }) {
  if (telling === null) {
    return (
      <p class="ending-small tree-diff-hint" data-testid="tree-diff-hint">
        {t("ending.diff.hint")}
      </p>
    );
  }
  const earlier = previousTelling(chain.told, telling);
  const after = versionWords(chain, telling.prop, lang);
  const before = earlier === null ? "" : versionWords(chain, earlier.prop, lang);
  const diff = earlier === null ? null : diffWords(before, after, lang);
  return (
    <div class="tree-diff" data-testid="tree-diff" data-telling={telling.id} data-same={diff?.same ?? false}>
      <p class="tree-diff-head">{t("ending.diff.said", { from: nameOf(telling.from), to: nameOf(telling.to) })}</p>
      {diff === null ? (
        <>
          <p class="tree-diff-note" data-testid="diff-first">
            {t("ending.diff.first")}
          </p>
          <p class="tree-diff-row">
            <span class="tree-diff-label">{t("ending.diff.after")}</span>
            <span class="tree-diff-text" data-testid="diff-after">
              {after}
            </span>
          </p>
        </>
      ) : (
        <>
          <p class="tree-diff-row">
            <span class="tree-diff-label">{t("ending.diff.before")}</span>
            <Runs runs={diff.before} testid="diff-before" />
          </p>
          <p class="tree-diff-row">
            <span class="tree-diff-label">{t("ending.diff.after")}</span>
            <Runs runs={diff.after} testid="diff-after" />
          </p>
          {diff.same ? (
            <p class="tree-diff-note" data-testid="diff-same">
              {t("ending.diff.same")}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function Chain({ chain, scene, lang }: { chain: RevealChain; scene: Scene | null; lang: Lang }) {
  const [picked, setPicked] = useState<string | null>(null);
  const nameOf = (id: string): string => nameFor(scene, id, lang);
  const layout = useMemo(() => layoutForest(buildForest(chain.told), nameOf), [chain, scene, lang]);
  // The tellings that changed the story, as the tree shows them, in the order they were made.
  const changes = layout.edges.map((edge) => edge.telling).filter((telling) => telling.op !== "").sort((a, b) => a.tick - b.tick);
  const numbers = new Map(changes.map((telling, i) => [telling.id, i + 1]));
  const title = said(chain.label, lang, `ending.chain.${chain.id}`);
  const opText = (op: string): string => (hasMessage(`ending.op.${op}`) ? t(`ending.op.${op}` as "ending.op.level") : t("ending.op.other"));
  return (
    <article class="ending-chain" data-testid="reveal-chain" data-chain={chain.id}>
      <h4 class="ending-chain-title">{title === "" ? chain.id : title}</h4>
      {chain.told.length === 0 ? (
        <p class="ending-quiet">{t("ending.chain.empty")}</p>
      ) : (
        <>
          <p class="ending-small">
            {t("ending.chain.reached", { n: count(lang, chain.reached.length) })} {t("ending.chain.legend")}
          </p>
          <ChainTree chain={chain} layout={layout} numbers={numbers} scene={scene} lang={lang} picked={picked} onPick={(id) => setPicked((now) => (now === id ? null : id))} />
          <TellingDiff chain={chain} telling={chain.told.find((telling) => telling.id === picked) ?? null} nameOf={nameOf} lang={lang} />
          {changes.length === 0 ? null : (
            <ol class="tree-changes" data-testid="tree-changes">
              {changes.map((telling, i) => {
                const words = quote(chain, telling.prop, lang);
                return (
                  <li key={telling.id} data-testid="tree-change" data-prop={telling.prop}>
                    <span class="tree-number">{i + 1}</span>
                    <span class="tree-change-body">
                      <span class="tree-change-line">{t("ending.chain.changedLine", { from: nameOf(telling.from), to: nameOf(telling.to), how: opText(telling.op) })}</span>
                      {words === "" ? null : (
                        <span class="tree-quote" data-testid="tree-quote">
                          {words}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </article>
  );
}

/** The words of one version of a story between quotation marks, in the language of the page. Empty when the chain has none for it. */
function quote(chain: RevealChain, prop: string, lang: Lang): string {
  const words = versionWords(chain, prop, lang);
  return words === "" ? "" : t("ending.quote", { words });
}

/** How a thing was told, in a few words: the way, and a note if it was a lie that the listener caught. */
function howText(telling: MyTelling, lang: Lang): string {
  const parts = [t(hasMessage(`ending.way.${telling.way}`) ? (`ending.way.${telling.way}` as "ending.way.faithful") : "ending.way.other")];
  // Making something up is a lie by its name.
  if (telling.lie && telling.way !== "fabricate") parts.push(t("ending.spoke.lie"));
  if (telling.caught) parts.push(t("ending.spoke.caughtTag"));
  return parts.join(lang === "zh" ? "，" : ", ");
}

function Pills({ ids, scene, lang }: { ids: readonly string[]; scene: Scene | null; lang: Lang }) {
  return (
    <ul class="ending-pills">
      {ids.map((id) => (
        <li key={id}>{nameFor(scene, id, lang)}</li>
      ))}
    </ul>
  );
}

/** What became of the people who carry the days: a name and one or two sentences for each, under the result of the night. */
function Epilogue({ lines, scene, lang }: { lines: readonly EpilogueLine[]; scene: Scene | null; lang: Lang }) {
  return (
    <section class="ending-card ending-wide ending-after" data-testid="reveal-epilogue" aria-labelledby="ending-epilogue-title">
      <h3 class="ending-card-title" id="ending-epilogue-title">
        {t("ending.epilogue.title")}
      </h3>
      <ul class="ending-epilogue">
        {lines.map((line) => (
          <li key={line.npc} data-testid="epilogue-line" data-npc={line.npc} data-entry={line.id}>
            <strong class="epilogue-name">{nameFor(scene, line.npc, lang)}</strong>
            <span class="epilogue-text">{said(line.text, lang, "")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export interface EndingPageProps {
  ending: EndingView;
  scene: Scene | null;
  lang: Lang;
  onNew(): void;
  onBack(): void;
  /** What the first button says, where it is not "New game": a recording has no new game to start. */
  newLabel?: MessageKey;
  /** The moments of the game at the foot of the page, one small picture for each. */
  moments?: readonly MomentCard[];
  /** How many riddles of the lantern at the workshop were guessed right, said in one small line, for a player who opened the lantern at least once. Null for one who did not. */
  riddles?: number | null;
}

/** The ending page, over the map: how the night went, what really happened, and how the rumours travelled. */
export function EndingPage({ ending, scene, lang, onNew, onBack, newLabel = "ending.new", moments = [], riddles = null }: EndingPageProps) {
  const reveal = ending.reveal;
  const title = said(ending.label, lang, `ending.id.${ending.id}`);
  const inputs = Object.entries(ending.inputs);
  const passageKey = ending.passage === null ? null : `ending.passage.${ending.passage}`;
  const truth = reveal?.truth ?? null;
  /** A count of the town in the language: characters in Chinese, digits in English. */
  const n = (value: number): string => count(lang, value);
  return (
    <section class="ending" role="dialog" aria-modal="false" aria-labelledby="ending-title" data-testid="ending" data-ending={ending.id}>
      <div class="ending-sheet paper-page">
        <header class="ending-head">
          <h2 class="ending-title" id="ending-title" data-testid="ending-title">
            {title === "" ? ending.id : title}
          </h2>
          {ending.hidden.length === 0 ? null : (
            <ul class="ending-tags" aria-label={t("ending.hidden")} data-testid="ending-tags">
              {ending.hidden.map((tag) => (
                <li key={tag.id} class="ending-tag" data-testid="ending-tag" data-id={tag.id}>
                  {said(tag.label, lang, `ending.id.${tag.id}`) || tag.id}
                </li>
              ))}
            </ul>
          )}
        </header>

        <div class="ending-grid">
          {ending.epilogue === null || ending.epilogue.length === 0 ? null : <Epilogue lines={ending.epilogue} scene={scene} lang={lang} />}
          <section class="ending-card" data-testid="ending-numbers">
            <h3 class="ending-card-title">{t("ending.night")}</h3>
            <dl class="ending-numbers">
              <div>
                <dt>{t("hud.promised")}</dt>
                <dd data-testid="ending-promised">{ending.promised === null ? t("hud.none") : t("unit.households", { n: n(ending.promised) })}</dd>
              </div>
              <div>
                <dt>{t("hud.turnout")}</dt>
                <dd data-testid="ending-turnout">{ending.turnout === null ? t("hud.none") : t("unit.people", { n: n(ending.turnout) })}</dd>
              </div>
              {passageKey === null || !hasMessage(passageKey) ? null : (
                <div>
                  <dt>{t("ending.passage")}</dt>
                  <dd data-testid="ending-passage">{t(passageKey as "ending.passage.mended")}</dd>
                </div>
              )}
            </dl>
            {inputs.length === 0 ? null : (
              <ul class="ending-checks" data-testid="ending-checks">
                {inputs.map(([name, done]) => (
                  <li key={name} class={done ? "is-done" : "is-missing"} data-input={name} data-done={done}>
                    <span class="ending-check-mark" aria-hidden="true">
                      {done ? <Tick seed={name} /> : null}
                    </span>
                    {hasMessage(`ending.input.${name}`) ? t(`ending.input.${name}` as "ending.input.reconciled") : name}
                    <span class="ending-check-word">{done ? t("ending.yes") : t("ending.no")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {truth === null ? null : (
            <section class="ending-card" data-testid="reveal-truth" data-variant={truth.variant}>
              <h3 class="ending-card-title">{t("ending.truth.title")}</h3>
              <p class="ending-truth">{said(truth.label, lang, `ending.truth.${truth.variant}`) || truth.variant}</p>
            </section>
          )}

          {reveal === null ? (
            <p class="ending-quiet ending-wide" data-testid="reveal-missing">
              {t("ending.noReveal")}
            </p>
          ) : (
            <>
              {reveal.chains.length === 0 ? null : (
                <section class="ending-card ending-wide" data-testid="reveal-chains">
                  <h3 class="ending-card-title">{t("ending.chains.title")}</h3>
                  {reveal.chains.map((chain) => (
                    <Chain key={chain.id} chain={chain} scene={scene} lang={lang} />
                  ))}
                </section>
              )}
              {reveal.spoke === null ? null : (
                <section class="ending-card" data-testid="reveal-spoke">
                  <h3 class="ending-card-title">{t("ending.spoke.title")}</h3>
                  {reveal.spoke.tellings === 0 ? (
                    <p class="ending-quiet">{t("ending.spoke.none")}</p>
                  ) : (
                    <dl class="ending-numbers">
                      <div>
                        <dt>{t("ending.spoke.tellings")}</dt>
                        <dd data-testid="spoke-tellings">
                          {n(reveal.spoke.tellings)}
                          {reveal.spoke.lies === 0 ? null : <span class="ending-aside">{`${lang === "zh" ? "，" : ", "}${t("ending.spoke.lies", { n: count(lang, reveal.spoke.lies) })}`}</span>}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("ending.spoke.reached")}</dt>
                        <dd data-testid="spoke-reached">{n(reveal.spoke.reached.length)}</dd>
                      </div>
                      {reveal.spoke.furthest === 0 ? null : (
                        <div>
                          <dt>{t("ending.spoke.furthest")}</dt>
                          <dd data-testid="spoke-furthest">{t("ending.spoke.hand", { hand: ordinal(lang, reveal.spoke.furthest) })}</dd>
                        </div>
                      )}
                      {reveal.spoke.retold === 0 ? null : (
                        <div>
                          <dt>{t("ending.spoke.retold")}</dt>
                          <dd>{n(reveal.spoke.retold)}</dd>
                        </div>
                      )}
                      {reveal.spoke.caught === 0 ? null : (
                        <div>
                          <dt>{t("ending.spoke.caught")}</dt>
                          <dd data-testid="spoke-caught">{n(reveal.spoke.caught)}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                  {reveal.spoke.reached.length === 0 ? null : (
                    <div class="ending-part" data-testid="spoke-reached-names">
                      <h4>{t("ending.spoke.reachedNames")}</h4>
                      <Pills ids={reveal.spoke.reached} scene={scene} lang={lang} />
                    </div>
                  )}
                  {reveal.tellings === null || reveal.tellings.length === 0 ? null : (
                    <div class="ending-part" data-testid="spoke-told">
                      <h4>{t("ending.spoke.told")}</h4>
                      <ul class="ending-said">
                        {reveal.tellings.slice(0, 8).map((telling, i) => (
                          <li key={i} data-testid="told-line" data-way={telling.way} data-lie={telling.lie} data-caught={telling.caught}>
                            {t("ending.spoke.toldLine", {
                              listener: nameFor(scene, telling.listener, lang),
                              words: telling.text === null ? "…" : t("ending.quote", { words: pick(telling.text, lang) }),
                              how: howText(telling, lang),
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              {reveal.saidOfMe === null ? null : (
                <section class="ending-card" data-testid="reveal-said">
                  <h3 class="ending-card-title">{t("ending.said.title")}</h3>
                  {reveal.saidOfMe.length === 0 ? (
                    <p class="ending-quiet">{t("ending.said.none")}</p>
                  ) : (
                    <ul class="ending-said">
                      {reveal.saidOfMe.slice(0, 8).map((line, i) => (
                        <li key={i} data-testid="said-line">
                          {t("ending.said.line", { speaker: nameFor(scene, line.speaker, lang), listener: nameFor(scene, line.listener, lang), text: pick(line.text, lang) })}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              {reveal.believers === null ? null : (
                <section class="ending-card ending-wide" data-testid="reveal-believers">
                  <h3 class="ending-card-title">{t("ending.believers.title")}</h3>
                  {(["true", "false", "none"] as const).map((side) => (
                    <div key={side} class={`ending-side ending-side-${side}`} data-side={side}>
                      <h4>
                        {t(`ending.believers.${side}`)} <span class="ending-count">{reveal.believers?.[side].length ?? 0}</span>
                      </h4>
                      <Pills ids={reveal.believers?.[side] ?? []} scene={scene} lang={lang} />
                    </div>
                  ))}
                  {reveal.told === null ? null : (
                    <p class="ending-small" data-testid="reveal-told">
                      {t("ending.told", { total: n(reveal.told.total), mutated: n(reveal.told.mutated) })}
                    </p>
                  )}
                </section>
              )}
            </>
          )}
          <MomentsRow cards={moments} scene={scene} lang={lang} />
          {riddles === null ? null : (
            <p class="ending-small ending-wide ending-riddles" data-testid="ending-riddles" data-right={riddles}>
              {t(riddleEndingKey(riddles), { n: lang === "zh" ? count("zh", riddles) : numberWord("en", riddles) })}
            </p>
          )}
        </div>

        <footer class="ending-foot">
          <button type="button" class="ink-frame" data-testid="ending-new" onClick={onNew}>
            {t(newLabel)}
          </button>
          <InkAct seed="ending-back" data-testid="ending-back" onClick={onBack}>
            {t("ending.back")}
          </InkAct>
        </footer>
      </div>
    </section>
  );
}
