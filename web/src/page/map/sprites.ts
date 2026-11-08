/**
 * Which sprite of the kit draws whom and what. The manifest says what the kit has; this says what
 * the town is drawn with. A sprite that is not in the manifest is not drawn: the map keeps
 * the shape made in code for it. Nothing here counts the frames or knows where they are: that is the
 * manifest's, so a sprite that a later bake adds needs a line here and no more.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */

/** The figure of the festival manager, who is the player. */
export const PLAYER_SPRITE = "char.zongguan";

/** The people of the cast, by their id in `content/cast/bridge_v0.yaml`, each with a figure of their own. */
export const NAMED_FIGURES: Readonly<Record<string, string>> = {
  li_laotai: "char.li_laotai",
  li_da: "char.li_da",
  li_er: "char.li_er",
  shitou: "char.shitou",
  li_xiaomei: "char.li_xiaomei",
  zhou_zhanggui: "char.zhou_zhanggui",
  zhou_niangzi: "char.zhou_niangzi",
  zhou_dalang: "char.zhou_dalang",
  zhou_erlang: "char.zhou_erlang",
  zhou_huoji: "char.zhou_huoji",
  cha_laoban: "char.laobanniang",
  sishu_xiansheng: "char.sishu_xiansheng",
  old_he: "char.lao_he",
  zuzhang: "char.zhanglao",
  zhangfang: "char.zhangfang",
  miaozhu: "char.miaozhu",
  xiao_man: "char.xiao_man",
  gengfu: "char.gengfu",
  mujiang: "char.mujiang",
  zhadeng_shifu: "char.zhadeng_shifu",
};

/**
 * The sprite that draws a person, or null if there is none and the person is drawn as a piece with
 * a surname on it. `has` says whether the manifest has a sprite. A person has the figure named for
 * them above, or else the one that the manifest names `char.<id>`.
 */
export function figureFor(id: string, has: (sprite: string) => boolean, player = false): string | null {
  if (player) return has(PLAYER_SPRITE) ? PLAYER_SPRITE : null;
  const named = NAMED_FIGURES[id];
  if (named !== undefined) return has(named) ? named : null;
  return has(`char.${id}`) ? `char.${id}` : null;
}

/**
 * The sprites of a place: the one it has, the one for a broken bridge, and the others that the
 * buildings of a place with several of them take in turn (the stalls of the market: warm and blue awnings).
 */
export interface PlaceArt {
  whole: string;
  broken?: string;
  others?: readonly string[];
}

/** The places that are drawn with a sprite, by place id of the scene. */
export const PLACE_ART: Readonly<Record<string, PlaceArt>> = {
  p_teahouse: { whole: "place.teahouse" },
  p_li_house: { whole: "place.li_house" },
  p_zhou_house: { whole: "place.zhou_house" },
  p_ferry: { whole: "place.ferry_pier" },
  p_bridge: { whole: "place.bridge", broken: "place.bridge_broken" },
  p_school: { whole: "place.school" },
  p_accountant_home: { whole: "place.accountant_home" },
  p_watch_post: { whole: "place.watch_post" },
  p_market: { whole: "place.market_stall", others: ["place.market_stall_blue"] },
  p_workshop: { whole: "place.workshop" },
  p_carpenter_home: { whole: "place.carpenter_home" },
  p_xiaoman_home: { whole: "place.xiaoman_home" },
  p_tavern: { whole: "place.tavern" },
  p_clan_hall: { whole: "place.clan_hall" },
  p_temple: { whole: "place.temple" },
  p_he_home: { whole: "place.he_home" },
};

/** The props. */
export const PROPS = {
  willow: "prop.willow",
  bambooSmall: "prop.bamboo_small",
  bambooLarge: "prop.bamboo_large",
  lanternLit: "prop.door_lantern_lit",
  lanternUnlit: "prop.door_lantern_unlit",
  glow: "fx.lantern_glow",
  treeRound: "prop.tree_round",
  treeUmbrella: "prop.tree_umbrella",
  treeCypress: "prop.tree_cypress",
  treeBamboo: "prop.tree_bamboo",
  stoneHeap: "prop.stone_heap",
  junkPile: "prop.junk_pile",
} as const;

/**
 * The kinds of the trees that stand away from the water (the willows are the ones by it) and the share of the trees that each
 * kind is: a round broadleaf, a spreading one, a cypress, a clump of bamboo, and a heap of mossy stones where a cell of the map
 * that is a tree is a heap of stones instead. The shares add up to 1.
 */
export const TREE_KINDS: ReadonlyArray<{ sprite: string; share: number }> = [
  { sprite: PROPS.treeRound, share: 0.28 },
  { sprite: PROPS.treeUmbrella, share: 0.18 },
  { sprite: PROPS.treeCypress, share: 0.2 },
  { sprite: PROPS.treeBamboo, share: 0.16 },
  { sprite: PROPS.stoneHeap, share: 0.18 },
];

/** The sprite of a kind of tree for a number from 0 up to 1 (see `noise` in palette.ts): the kinds in turn, each as long as its share. */
export function treeSprite(h: number): string {
  let upTo = 0;
  for (const kind of TREE_KINDS) {
    upTo += kind.share;
    if (h < upTo) return kind.sprite;
  }
  return (TREE_KINDS[TREE_KINDS.length - 1] as { sprite: string }).sprite;
}

/** How far from a river or a bank a tree can be and still be a willow, in cells. */
export const WILLOW_REACH = 3;

/** The bamboo pile for an amount at the bridge: small for 1 to 9, large for 10 or more, none for nothing. */
export function bambooPile(amount: number): string | null {
  if (!(amount >= 1)) return null;
  return amount >= 10 ? PROPS.bambooLarge : PROPS.bambooSmall;
}

/** Whether the bridge is whole, from the `bridge` of the hud. It is broken until the state says it is mended. */
export function bridgeIsWhole(hud: Record<string, unknown>): boolean {
  const bridge = hud.bridge;
  return typeof bridge === "object" && bridge !== null && !Array.isArray(bridge) && (bridge as Record<string, unknown>).state === "mended";
}
