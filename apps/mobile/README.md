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

## What is deliberately missing

**Auto-selection.** The single strongest argument for building a native client
at all (design §1) and the one piece whose design depends on the geotag
coverage number that has not been measured. `tools/geotag-probe` exists to get
that number; until it does, the app uses the system picker and asks for no
photo-library permission whatsoever.

That ordering is intentional. Everything here works without auto-selection, and
the screen it lands on — the picker — is already built.

## Notes

Identity is a bearer token in the keychain, the same signed value the web
client keeps in a cookie. On iOS keychain items can outlive an uninstall, which
would silently restore an identity someone thought they discarded; nothing here
depends on it either way.

The event link is held in the keychain and presented per request rather than
exchanged for a scoped capability. That differs from the web, where the point
of the exchange is keeping the token out of the address bar and out of referer
headers — neither of which exists on native.
