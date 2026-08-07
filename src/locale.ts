import type { ASCClient } from "./client.js";

interface WithLocale {
  id: string;
  attributes: { locale: string };
}

/**
 * Pick the localization to write to when the caller did not name one.
 *
 * `locs[0]` was the old answer, and Apple does not promise an order for
 * appStoreVersionLocalizations or appInfoLocalizations. On a single-locale app
 * that is harmless; on an app with en-US and ja it is a coin flip, and the
 * things written through here (description, keywords, name, subtitle,
 * screenshots) are the public App Store listing. English release notes landing
 * on the Japanese listing is not something the caller would notice until a user
 * did. The same class of bug as the appInfo one, where Apple lists the live
 * record before the draft and a limit=1 read wrote to the wrong one.
 *
 * The app's own primaryLocale is the only defensible default: it is the locale
 * Apple itself falls back to. If it is not among the localizations, the caller
 * is told to name one rather than being given a guess.
 */
export async function resolveLocalization<T extends WithLocale>(
  client: ASCClient,
  appId: string,
  localizations: T[],
  requested: string | undefined,
  what: string,
): Promise<{ loc: T } | { error: string }> {
  if (requested) {
    const found = localizations.find((l) => l.attributes.locale === requested);
    return found
      ? { loc: found }
      : {
          error:
            `Locale "${requested}" is not on ${what}. Available: ` +
            `${localizations.map((l) => l.attributes.locale).join(", ") || "none"}.`,
        };
  }

  if (localizations.length === 1) return { loc: localizations[0] };
  if (localizations.length === 0) return { error: `No localizations found on ${what}.` };

  let primary: string | undefined;
  try {
    const res = await client.get<{ primaryLocale: string }>(`/v1/apps/${appId}`, {
      "fields[apps]": "primaryLocale",
    });
    const app = Array.isArray(res.data) ? res.data[0] : res.data;
    primary = app?.attributes?.primaryLocale;
  } catch {
    // Fall through to the explicit-locale message below.
  }

  const match = primary ? localizations.find((l) => l.attributes.locale === primary) : undefined;
  if (match) return { loc: match };

  return {
    error:
      `This app has ${localizations.length} localizations (` +
      `${localizations.map((l) => l.attributes.locale).join(", ")}) and no locale was given, so there is no ` +
      `safe default: writing to the wrong one puts the wrong language on a public listing. Pass locale explicitly.`,
  };
}
