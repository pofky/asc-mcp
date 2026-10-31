import { DUO_REQUIRED_FROM, DUO_SDK_FROM, IPAD_REQUIRED_SET, IPHONE_ACCEPTED_SETS, LIMITS, PLACEHOLDER_PATTERNS, PLATFORM_REQUIRED_SET, TERMS_LINK_PATTERN, type RuleId } from "../rules.js";
import type { BuildInfo, Finding, Part, ProjectInput, RecordSnapshot, ScreenshotSet, Status, VersionLocalization, VersionSnapshot } from "../types.js";

/** Apple's own rejections. DEVELOPER_REJECTED is the developer withdrawing it, which has no reasons to read. */
export const REJECTED_STATES: ReadonlySet<string> = new Set(["REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);

const finding = (rule: RuleId, status: Status, saw: string, scope?: string): Finding => ({ rule, status, saw, scope });

/** A read that failed says so for every rule that depended on it. */
const unknownFor = (rules: RuleId[], part: { ok: false; reason: string }): Finding[] =>
  rules.map((rule) => finding(rule, "unknown", part.reason));

const isBlank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

function checkLocalization(loc: VersionLocalization, v: VersionSnapshot): Finding[] {
  const out: Finding[] = [];
  const scope = loc.locale;
  const desc = loc.description;
  if (isBlank(desc)) out.push(finding("meta.description", "fail", "The description is empty.", scope));
  else if (desc!.length < LIMITS.descriptionMin) out.push(finding("meta.description", "fail", `The description is ${desc!.length} characters.`, scope));
  else if (desc!.length > LIMITS.descriptionMax) out.push(finding("meta.description", "fail", `The description is ${desc!.length} characters, over the ${LIMITS.descriptionMax} limit.`, scope));
  else out.push(finding("meta.description", "pass", `${desc!.length}/${LIMITS.descriptionMax} characters.`, scope));

  if ((loc.keywords?.length ?? 0) > LIMITS.keywordsMax) out.push(finding("meta.keywords", "fail", `Keywords are ${loc.keywords!.length} characters, over the ${LIMITS.keywordsMax} limit.`, scope));
  else if (isBlank(loc.keywords)) out.push(finding("meta.keywords", "warn", "Keywords are empty. Not required, but they help people find the app.", scope));
  else out.push(finding("meta.keywords", "pass", `${loc.keywords!.length}/${LIMITS.keywordsMax} characters.`, scope));

  if ((loc.promotionalText?.length ?? 0) > LIMITS.promotionalTextMax) out.push(finding("meta.promo", "fail", `Promotional text is ${loc.promotionalText!.length} characters, over the ${LIMITS.promotionalTextMax} limit.`, scope));
  else out.push(finding("meta.promo", "pass", "Within the limit, or not set.", scope));

  // Apple only takes What's New once something has been on the store, and that
  // has nothing to do with the version number: a first release can be 0.9 or 2.0.
  if (v.hasPriorRelease) {
    if (isBlank(loc.whatsNew)) out.push(finding("meta.whatsnew", "fail", "What's New is empty, and this app has an earlier release.", scope));
    else if (loc.whatsNew!.length > LIMITS.whatsNewMax) out.push(finding("meta.whatsnew", "fail", `What's New is ${loc.whatsNew!.length} characters, over the ${LIMITS.whatsNewMax} limit.`, scope));
    else out.push(finding("meta.whatsnew", "pass", `${loc.whatsNew!.length} characters.`, scope));
  }

  const fields: Array<[string, string | null]> = [["description", loc.description], ["keywords", loc.keywords], ["what's new", loc.whatsNew], ["promotional text", loc.promotionalText]];
  const dirty = fields.filter(([, text]) => text && PLACEHOLDER_PATTERNS.some((p) => p.test(text))).map(([name]) => name);
  out.push(
    dirty.length
      ? finding("meta.placeholder", "warn", `Looks like placeholder text in: ${dirty.join(", ")}.`, scope)
      : finding("meta.placeholder", "pass", "No placeholder wording found.", scope),
  );
  return out;
}

/** True or false when something says so, and null when nothing does. */
export function iPadEvidence(build: Part<BuildInfo | null>, project: ProjectInput, sets: ScreenshotSet[]): { runsOnIpad: boolean | null; how: string } {
  if (project.provided && "scan" in project && project.scan.runsOnIpad !== null) {
    return { runsOnIpad: project.scan.runsOnIpad, how: "the project's device family setting" };
  }
  // Apple exposes no device family on a build. The icon it extracted does differ:
  // on 2026-10-31, every app with a universal target showed AppIcon76x76@2x~ipad
  // and the iPhone-only targets AppIcon60x60@2x. Inferred, so a missing marker is
  // reported as a warning and never as proof.
  if (build.ok && build.value?.iconFile) {
    return /ipad/i.test(build.value.iconFile)
      ? { runsOnIpad: true, how: "the build's iPad icon" }
      : { runsOnIpad: false, how: "the build's icon, which is an inference" };
  }
  if (sets.some((s) => s.displayType.includes("IPAD"))) return { runsOnIpad: true, how: "its iPad screenshots" };
  return { runsOnIpad: null, how: "" };
}

/** True at or above the SDK that brings the Duo rule; null when the number will not parse. */
export function isDuoSdk(sdkBuild: string | null): boolean | null {
  const m = sdkBuild?.match(/^(\d+)([A-Z])/);
  if (!m) return null;
  const major = Number(m[1]);
  return major > DUO_SDK_FROM.major || (major === DUO_SDK_FROM.major && m[2] >= DUO_SDK_FROM.letter);
}

function checkDuo(v: VersionSnapshot, sets: ScreenshotSet[], today: string): Finding[] {
  if (v.platform !== "IOS" || !v.build.ok || !v.build.value) return [];
  if (sets.some((s) => /DUO/i.test(s.displayType))) return [finding("shots.duo", "pass", "An iPhone Duo set is present.")];
  const onSdk = isDuoSdk(v.build.value.sdkBuild);
  const required = today >= DUO_REQUIRED_FROM;
  if (onSdk === true) {
    return [required
      ? finding("shots.duo", "fail", "This build uses the iOS 27.1 SDK or later, and no iPhone Duo set is present.")
      : finding("shots.duo", "warn", `This build uses the iOS 27.1 SDK or later. From April 2027 such apps need iPhone Duo screenshots.`)];
  }
  if (onSdk === null && required) return [finding("shots.duo", "unknown", "Could not read this build's SDK, so whether iPhone Duo screenshots are required is unknown.")];
  // Apple's spec page scopes the rule to the iOS 27.1 SDK; its 5 October 2026
  // release note says any app submitted from April 2027. So not a failure, not silence.
  if (required) return [finding("shots.duo", "warn", "No iPhone Duo set. Apple's screenshot page requires one from the iOS 27.1 SDK, which this build predates, but its release note says any app submitted from April 2027. Check App Store Connect.")];
  return [];
}

function checkScreenshots(v: VersionSnapshot, primaryLocale: string | null, project: ProjectInput, today: string): Finding[] {
  if (!v.screenshots.ok) return unknownFor(["shots.required", "shots.nonempty"], v.screenshots);
  const byLocale = v.screenshots.value;
  const locales = Object.keys(byLocale);
  if (!locales.length) return [];

  // A locale with no sets uses the primary language's, so required sets are
  // judged on the primary locale. A set that exists and is empty is judged anywhere.
  const anchor = primaryLocale && byLocale[primaryLocale] ? primaryLocale : locales[0];
  const anchorSets = byLocale[anchor].filter((s) => s.imageStates.length > 0);
  const scope = anchor;
  const out: Finding[] = [];
  const has = (type: string) => anchorSets.some((s) => s.displayType === type);

  if (v.platform === "IOS") {
    if (IPHONE_ACCEPTED_SETS.some(has)) out.push(finding("shots.required", "pass", "An iPhone set is present.", scope));
    else if (anchorSets.some((s) => s.displayType.startsWith("APP_IPHONE"))) out.push(finding("shots.required", "fail", `Only smaller iPhone sets are present. Apple scales down from the large sets, not up, so add ${IPHONE_ACCEPTED_SETS[0]}.`, scope));
    else out.push(finding("shots.required", "fail", `No iPhone screenshots with images. Add ${IPHONE_ACCEPTED_SETS[0]}.`, scope));

    const ipad = iPadEvidence(v.build, project, byLocale[anchor]);
    if (has(IPAD_REQUIRED_SET)) {
      out.push(finding("shots.required", "pass", "A 13-inch iPad set is present.", scope));
    } else if (ipad.runsOnIpad === true) {
      out.push(finding("shots.required", "fail", `This app runs on iPad, going by ${ipad.how}, and there is no ${IPAD_REQUIRED_SET} set with images.`, scope));
    } else if (ipad.runsOnIpad === null) {
      out.push(finding("shots.required", "unknown", "Could not tell whether this app runs on iPad, so the iPad set could not be judged. Attach a build, or pass project_path.", scope));
    } else if (!(project.provided && "scan" in project && project.scan.runsOnIpad === false)) {
      out.push(finding("shots.required", "warn", `This looks iPhone-only, going by ${ipad.how}. If it runs on iPad it also needs ${IPAD_REQUIRED_SET}. Pass project_path to settle it.`, scope));
    }
    out.push(...checkDuo(v, byLocale[anchor], today));
  } else {
    const required = PLATFORM_REQUIRED_SET[v.platform];
    if (required) {
      out.push(has(required)
        ? finding("shots.required", "pass", `A ${required} set is present.`, scope)
        : finding("shots.required", "fail", `No ${required} set with images.`, scope));
    } else {
      out.push(finding("shots.required", "unknown", `This tool has no screenshot rule for platform ${v.platform}.`, scope));
    }
  }

  let imagesChecked = 0;
  for (const locale of locales) {
    for (const set of byLocale[locale]) {
      if (set.imageStates.length === 0) {
        out.push(finding("shots.nonempty", "fail", `The ${set.displayType} set has no images.`, locale));
        continue;
      }
      imagesChecked += set.imageStates.length;
      const failed = set.imageStates.filter((s) => s === "FAILED" || s === "AWAITING_UPLOAD").length;
      const pending = set.imageStates.filter((s) => s !== "COMPLETE" && s !== "FAILED" && s !== "AWAITING_UPLOAD").length;
      if (failed) out.push(finding("shots.nonempty", "fail", `${failed} image(s) in ${set.displayType} did not finish uploading. Upload them again.`, locale));
      else if (pending) out.push(finding("shots.nonempty", "warn", `${pending} image(s) in ${set.displayType} are still processing. Re-run in a few minutes.`, locale));
    }
  }
  if (imagesChecked && !out.some((f) => f.rule === "shots.nonempty")) out.push(finding("shots.nonempty", "pass", `${imagesChecked} image(s) delivered.`));
  return out;
}

function checkBuild(v: VersionSnapshot): Finding[] {
  if (!v.build.ok) return unknownFor(["build.attached", "build.encryption"], v.build);
  const build = v.build.value;
  if (!build) return [finding("build.attached", "fail", "No build is attached to this version.")];
  const out: Finding[] = [];
  const stillSubmittable = !v.auditingLive;
  if (build.processingState === "PROCESSING") out.push(finding("build.attached", "warn", `Build ${build.version} is still processing.`));
  else if (build.processingState !== "VALID") out.push(finding("build.attached", "fail", `Build ${build.version} is in state ${build.processingState}.`));
  // Expiry ends TestFlight access; a build already live keeps working on the store.
  else if (build.expired && stillSubmittable) out.push(finding("build.attached", "fail", `Build ${build.version} has expired. Upload a new one.`));
  else out.push(finding("build.attached", "pass", `Build ${build.version} is attached and valid.`));

  if (build.usesNonExemptEncryption === null) out.push(finding("build.encryption", "fail", `Export compliance is not answered for build ${build.version}.`));
  else if (build.usesNonExemptEncryption) out.push(finding("build.encryption", "warn", "This build declares non-exempt encryption. Apple may want documentation on the website."));
  else out.push(finding("build.encryption", "pass", "Answered: no non-exempt encryption."));
  return out;
}

function checkReview(v: VersionSnapshot, project: ProjectInput): Finding[] {
  if (!v.review.ok) return unknownFor(["review.contact", "review.demo"], v.review);
  const review = v.review.value;
  const out: Finding[] = [];
  const missing = (["contactFirstName", "contactLastName", "contactPhone", "contactEmail"] as const).filter((k) => isBlank(review?.[k]));
  out.push(missing.length
    ? finding("review.contact", "fail", `Missing: ${missing.join(", ")}.`)
    : finding("review.contact", "pass", "Contact details are set."));

  if (review?.demoAccountRequired && isBlank(review.demoAccountName)) {
    out.push(finding("review.demo", "warn", "A demo account is marked as required, and no username is set."));
  } else if (!review?.demoAccountRequired && project.provided && "scan" in project && project.scan.signInSeenAt) {
    out.push(finding("review.demo", "warn", `This project appears to have a sign-in (${project.scan.signInSeenAt}) and no demo account is declared. Reviewers need one if the app requires login.`));
  } else {
    out.push(finding("review.demo", "pass", "Nothing here contradicts the demo account setting."));
  }
  return out;
}

/** Rules for one version of the app. */
export function checkVersion(v: VersionSnapshot, primaryLocale: string | null, project: ProjectInput, today: string, appId: string): Finding[] {
  const out: Finding[] = [];
  // Apple's API gives the state and not the reasons, so this report cannot know
  // whether they were dealt with, and a clean line here would read as "resubmit".
  if (REJECTED_STATES.has(v.state)) {
    out.push(finding("version.rejected", "unknown", `Apple rejected this version (${v.state}), and its API does not give the reasons, so this report cannot check them. Read them in App Store Connect and confirm each is dealt with: https://appstoreconnect.apple.com/apps/${appId}/distribution`));
  }
  if (v.localizations.ok) {
    if (!v.localizations.value.length) out.push(finding("locale.present", "fail", "This version has no localizations."));
    else out.push(finding("locale.present", "pass", `${v.localizations.value.length} locale(s).`));
    for (const loc of v.localizations.value) out.push(...checkLocalization(loc, v));
  } else {
    out.push(...unknownFor(["locale.present", "meta.description", "meta.keywords", "meta.promo", "meta.whatsnew", "meta.placeholder"], v.localizations));
  }
  out.push(...checkScreenshots(v, primaryLocale, project, today));
  out.push(...checkBuild(v));
  out.push(isBlank(v.copyright)
    ? finding("app.copyright", "fail", "No copyright line on this version.")
    : finding("app.copyright", "pass", "Copyright is set."));
  out.push(...checkReview(v, project));
  return out;
}

/** Product states that need no action from the developer before this submission. */
const PRODUCT_OK = new Set(["READY_TO_SUBMIT", "WAITING_FOR_REVIEW", "IN_REVIEW", "APPROVED", "PENDING_BINARY_APPROVAL", "WAITING_FOR_UPLOAD"]);
/** Withdrawn on purpose. These are not part of what is being sold, so they are not judged. */
const PRODUCT_WITHDRAWN = new Set(["REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"]);

/** Rules that belong to the app, whichever version is being looked at. */
export function checkApp(record: RecordSnapshot): Finding[] {
  const out: Finding[] = [];
  if (record.app.ok) {
    out.push(record.app.value.contentRights
      ? finding("app.content_rights", "pass", "Declared.")
      : finding("app.content_rights", "fail", "The content rights declaration is not answered."));
  } else out.push(...unknownFor(["app.content_rights"], record.app));

  if (record.appInfo.ok) {
    const info = record.appInfo.value;
    out.push(info.ageDeclared ? finding("app.age", "pass", "Age rating is set.") : finding("app.age", "fail", "The age rating declaration has not been filled in."));
    out.push(info.hasPrimaryCategory ? finding("app.category", "pass", "Primary category is set.") : finding("app.category", "fail", "No primary category."));
    for (const loc of info.localizations) {
      if (isBlank(loc.name)) out.push(finding("meta.name", "fail", "The app name is empty.", loc.locale));
      else if (loc.name!.length > LIMITS.nameMax) out.push(finding("meta.name", "fail", `The name is ${loc.name!.length} characters, over the ${LIMITS.nameMax} limit.`, loc.locale));
      else out.push(finding("meta.name", "pass", `${loc.name!.length}/${LIMITS.nameMax} characters.`, loc.locale));
      if ((loc.subtitle?.length ?? 0) > LIMITS.subtitleMax) out.push(finding("meta.subtitle", "fail", `The subtitle is ${loc.subtitle!.length} characters, over the ${LIMITS.subtitleMax} limit.`, loc.locale));
    }
  } else out.push(...unknownFor(["app.age", "app.category", "meta.name"], record.appInfo));

  if (record.hasManualPrice.ok) {
    out.push(record.hasManualPrice.value ? finding("app.price", "pass", "A price is set.") : finding("app.price", "fail", "No price has been set, not even free."));
  } else out.push(...unknownFor(["app.price"], record.hasManualPrice));

  for (const part of [record.iaps, record.subscriptions]) {
    if (!part.ok) {
      out.push(...unknownFor(["iap.state"], part));
      continue;
    }
    for (const p of part.value) {
      if (PRODUCT_WITHDRAWN.has(p.state)) continue;
      out.push(PRODUCT_OK.has(p.state)
        ? finding("iap.state", "pass", p.state, p.productId)
        : finding("iap.state", "fail", `${p.state}. Finish its localization, price, availability and review screenshot, or delete it if this version does not sell it.`, p.productId));
    }
  }
  return out;
}

/** The Terms of Use links a description holds. */
export function termsLinksIn(description: string | null): string[] {
  if (!description) return [];
  const out: string[] = [];
  for (const line of description.split("\n")) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
      const url = match[0].replace(/[.,;:!?]+$/, "");
      if (TERMS_LINK_PATTERN.test(url) || TERMS_LINK_PATTERN.test(line.replace(match[0], ""))) out.push(url);
    }
  }
  return out;
}

export function checkSubscriptionTerms(record: RecordSnapshot, v: VersionSnapshot): Finding[] {
  if (!record.subscriptions.ok) return unknownFor(["sub.terms"], record.subscriptions);
  if (!record.subscriptions.value.length) return [];
  if (!v.localizations.ok) return unknownFor(["sub.terms"], v.localizations);
  if (!record.hasCustomEula.ok) return unknownFor(["sub.terms"], record.hasCustomEula);
  if (record.hasCustomEula.value) return [finding("sub.terms", "pass", "A custom licence agreement is set in App Store Connect.")];
  const missing = v.localizations.value.filter((l) => !termsLinksIn(l.description).length);
  if (!missing.length) return [finding("sub.terms", "pass", "A Terms of Use link is in the description.")];
  return missing.map((l) =>
    // A link with an unusual address may still be the Terms, and only a person can tell.
    /https?:\/\//i.test(l.description ?? "")
      ? finding("sub.terms", "warn", "This app has subscriptions and no custom licence agreement, and no link in the description looks like Terms of Use. If one of them is, label it \"Terms of Use\" on its line.", l.locale)
      : finding("sub.terms", "fail", "This app has subscriptions, no custom licence agreement, and no Terms of Use link in the description. Apple's standard one is https://www.apple.com/legal/internet-services/itunes/dev/stdeula/", l.locale),
  );
}
