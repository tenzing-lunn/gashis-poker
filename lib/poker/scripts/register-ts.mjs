// Lets plain `node` run this folder's .ts files: Node 22 strips types natively but, like any ESM
// loader, won't guess file extensions. The library uses extensionless imports (for tsc/Next), so this
// hook retries a failed relative/absolute import with ".ts". Usage: node --import ./lib/poker/scripts/register-ts.mjs file.ts
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (/^(\.|\/|file:)/.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(specifier + ".ts", context);
      }
      throw err;
    }
  },
});
