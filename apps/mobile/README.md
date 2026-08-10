# Parea — native client

Design §7. React Native via Expo, iOS and Android, sharing every endpoint with
the web client — "two clients, one protocol".

```
npm install
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:3000 npm start
```

`npm test` covers the upload queue, which is the part worth testing: it is pure
and takes the platform through injected dependencies, so a crash mid-batch is
just constructing a new queue from the last persisted state.

## What native buys

Uploads that survive backgrounding **and app termination**, on iOS. SDK 57's
`UploadTask` takes `sessionType: 'background'` and hands the transfer to
`URLSession`; it is the default, and stated explicitly in `platform.ts` because
the whole "close the app, it keeps going" promise rests on it. **Android has no
equivalent** — uploads survive backgrounding for a while and die when the OS
reclaims the process — so the UI says "keep the app open" there and not on iOS.

A queue that survives being killed. State is persisted after every transition,
each file moves through presign → upload → complete independently, and retries
are safe because the server addresses objects by content.

Save-all to the camera roll, which is the terminal action people actually want
and a browser cannot offer. The zip endpoint is shared; on native the URLs it
returns get written to the photo library instead.

QR scanning and spoken codes, so the at-the-party join moment works without
anyone typing a URL.

## Auto-selection

The reason this client exists (design §1). With photo-library access and a
known time window, "Add photos" opens on what it thinks are your photos from
the event, already ticked — one tap instead of scrolling a camera roll.

Built to degrade correctly rather than to assume it works, because the geotag
coverage number it depends on **has not been measured** (`tools/geotag-probe`
exists to get it). Confidence decides how much is pre-selected, never whether
the screen appears:

| Signal | What happens |
|---|---|
| Most photos geotagged, tightly clustered | the cluster is pre-selected |
| Under 60% carry GPS | grid appears, **nothing ticked** |
| Geotagged but spread across places | grid appears, **nothing ticked** |
| No usable window | system picker |

Degrading to "here is a useful grid of the right time range, you pick" is a
good outcome. Degrading to forty-seven pre-ticked photos, three of which you
would be mortified to send, is the outcome that kills the feature — it spends
the contributor's trust and the photo-library permission in the same moment.
"Show everything from this window" is always available, which is what makes a
tight default safe rather than annoying.

The measurement therefore decides *which row of that table people mostly land
on*, not whether any of it works. Run the probe before assuming the top row.

The selection logic lives in `@parea/autoselect` and is shared, by fixture,
with the probe — so what the probe measures is what the app will do.

Permission is asked for **after** a first contribution, never in front of one:
the picker path needs no permission at all, and the upgrade is pitched as
"next time we can find them for you".

## Notes

Identity is a bearer token in the keychain, the same signed value the web
client keeps in a cookie. On iOS keychain items can outlive an uninstall, which
would silently restore an identity someone thought they discarded; nothing here
depends on it either way.

The event link is held in the keychain and presented per request rather than
exchanged for a scoped capability. That differs from the web, where the point
of the exchange is keeping the token out of the address bar and out of referer
headers — neither of which exists on native.
