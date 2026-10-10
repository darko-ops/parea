# PhotoDNA Edge Hash library

The deriver hashes uploads with Microsoft's PhotoDNA Edge Hash SDK — see
`src/edgeHash.ts` and docs/csam-runbook.md ("PhotoDNA: Edge Hashes, not
images"). The library is copied **here, by hand, on the machine that runs
`flyctl deploy`**, and is never committed: everything in this folder but this
file and `.gitignore` is ignored.

The file it needs is `photoDnaEdgeHashS.js`, from the SDK's `webassembly/`
folder (version 1.05.009). Before copying, check it against the SHA-256 in the
SDK's `PhotoDNA.EdgeHashGeneration-1.05.009-SHA256.txt`:

```
shasum -a 256 photoDnaEdgeHashS.js
# c643236d1682e748dca1d8ad38a29918bb35d2bc0b53a9a40c7a9c4aa700e5cf
```

`services/deriver` is copied whole into the image, so the file lands at
`/app/services/deriver/vendor/photodna/` there. It is used only once
`PHOTODNA_EDGEHASHGENERATOR` points at that folder; unset, PhotoDNA is asked
with the image, as before.

**AI agents must not open, read, copy or hash the library** — a condition of
Microsoft's licence for using the SDK with agents ("IMPORTANT NOTICE - USING
AI AGENTS WITH PHOTODNA", in the SDK download). A person copies it in.
