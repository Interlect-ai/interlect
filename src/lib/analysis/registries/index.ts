/** Adapterne pr. land. Et nyt land er én fil + én linje her. */
import { estoniaRegistry } from "./estonia.ts";
import { finlandRegistry } from "./finland.ts";
import { franceRegistry } from "./france.ts";
import { germanyRegistry, italyRegistry, spainRegistry } from "./gleif.ts";
import { latviaRegistry } from "./latvia.ts";
import { lithuaniaRegistry } from "./lithuania.ts";
import { netherlandsRegistry } from "./netherlands.ts";
import { norwayRegistry } from "./norway.ts";
import { polandRegistry } from "./poland.ts";
import { swedenRegistry } from "./sweden.ts";
import type { ForeignRegistryCountry, RegistryAdapter } from "./types.ts";

export * from "./types.ts";

const ADAPTERS: Record<ForeignRegistryCountry, RegistryAdapter> = {
  NO: norwayRegistry,
  SE: swedenRegistry,
  FI: finlandRegistry,
  EE: estoniaRegistry,
  LV: latviaRegistry,
  LT: lithuaniaRegistry,
  FR: franceRegistry,
  PL: polandRegistry,
  NL: netherlandsRegistry,
  DE: germanyRegistry,
  ES: spainRegistry,
  IT: italyRegistry,
};

export function registryAdapter(country: ForeignRegistryCountry): RegistryAdapter {
  return ADAPTERS[country];
}
