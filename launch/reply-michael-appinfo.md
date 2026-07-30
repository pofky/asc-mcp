# Reply draft: Michael Knuesel, appInfo 409 (reported against v1.8.2, fixed in v1.8.5)

Not sent. Send from your mail client, or via `POST /admin/announce` with the ANNOUNCE_TOKEN
secret (recipient must exist in the licenses table, which he does).

**Subject:** Fixed in v1.8.5, and you found three more places it was wrong

---

Hi Michael,

Your diagnosis was exactly right, and thank you for writing it up that precisely. It is
fixed. Please update:

    npx @pofky/asc-mcp@latest --version   # 1.8.5

What I confirmed before changing anything: one of my own apps returns two appInfos,
READY_FOR_SALE first and then the pending one, and patching that first record reproduces your
error verbatim ("The field 'subtitle' can not be modified in the current state"). So
`limit: "1"` was picking the locked record for any app that already has a release, exactly as
you said.

The fix follows your suggestion, in a new `src/app-info.ts`: fetch every appInfo with
`fields[appInfos]=appStoreState,state`, then select. Two details worth knowing if you touch
this API yourself:

- There are two state fields with different vocabularies for the same thing. `appStoreState`
  uses the version words (READY_FOR_SALE) and `state` uses the appInfo words
  (READY_FOR_DISTRIBUTION). The editable states are spelled identically in both, so one set
  covers either, but a check written only against `state` will miss.
- When nothing is editable, the tool now tells you so and names the states it found, instead
  of firing a PATCH that cannot succeed.

You were also right that privacy_policy_url rides the same path. Chasing that turned up three
more places with the same assumption, all fixed in the same release:

- `set_app_metadata`, because app categories are a relationship on appInfo.
- `set_age_rating`, because the age-rating declaration hangs off appInfo, so on an app with a
  pending version it was reading and patching the live one.
- `release_preflight`, which was the quiet one: it was auditing the live record, so it
  reported the shipped name, subtitle and privacy URL rather than the ones you are about to
  submit. It now audits the pending record when there is one.

One more thing I changed because of your report: a 409 on the app-level fields used to throw
and take the whole call down, which is why you saw an error even though the description and
keywords had already been written. Those changes now come back in the result with a note
about what Apple refused, so you can see what landed.

There are 13 unit tests covering the selection, and I verified the write end to end on a real
app (set a subtitle, read it back, restored it).

Your report also made me stop trusting my own reading of the code, so I ran every tool against
a real account instead. That turned up a few more things, all fixed in the same 1.8.5 you are
installing:

- `set_app_availability` was broken in both directions. Creating availability rejected any
  territory subset (Apple wants a territoryAvailability for all 175 on create), and updating
  used `/v2/territoryAvailabilities/{id}`, which 404s because those rows are v1 resources.
- 409 hints assumed a state conflict, so a rejected phone-number format told you to go check
  your version state. They now name the field Apple pointed at.
- `create_version` threw Apple's raw 409 instead of distinguishing "that version number was
  already used" from "a version is still open for editing".
- `list_builds` said "no builds found" for an app_id that does not exist.

So thank you twice: once for the bug, once for the nudge.

If anything else looks off, please keep sending it my way. Reports at this level of detail are
genuinely rare.

Povilas
