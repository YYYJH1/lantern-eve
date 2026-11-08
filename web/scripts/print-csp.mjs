// Prints the Content Security Policy of the page, for a host that can send it as a header.
// A <meta> tag covers the document only. The worker takes its policy from the headers of its own
// script, so send this on every response. Needs Node 22.18 or later, which reads TypeScript directly.
import { contentSecurityPolicy } from "../src/csp.ts";

console.log(contentSecurityPolicy());
