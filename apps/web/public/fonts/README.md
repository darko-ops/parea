# Garet

Not in this repository, deliberately. Font binaries are the one thing nearly
every foundry licence forbids redistributing — including licences that are
otherwise free to use — and this directory is public.

`globals.css` expects two files here:

    Garet-Book.woff2    (400)
    Garet-Heavy.woff2   (700)

Get them from the foundry with a **webfont** licence, which is a different
grant from a desktop one and is the grant `@font-face` needs. Convert OTF/TTF
to woff2 if that is what you are given.

Until they exist the wordmark falls through to Futura, then Avenir Next, then
Century Gothic, then the system UI face. That fallback is doing real work and
should stay: a missing file must not mean a missing brand.
