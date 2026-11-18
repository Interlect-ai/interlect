/** node --import ./scripts/lib/register-alias.mjs <script>: lets a script import app code. */
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
