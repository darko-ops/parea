# Garet

`garet-book.woff2` is the Book weight, converted from `assets/garet.book.ttf`
with fontTools. woff2 rather than the ttf: same outlines, 69% smaller, and
every browser that matters has supported it for years.

Regenerate with:

    python3 -c "from fontTools.ttLib import TTFont; f=TTFont('assets/garet.book.ttf'); f.flavor='woff2'; f.save('apps/web/public/fonts/garet-book.woff2')"

**One weight only.** `globals.css` declares it as 400 and uses it at 400. Do
not ask for 700 without adding a real Heavy file — the browser will synthesise
a bold by smearing the outlines, and at wordmark size that is visible.

## Licence

The font's own metadata names **Space Type** and points at an EULA at
`spacetype.co`. Two questions worth answering against that document, because
they have different answers under most foundry licences:

  - does it permit **webfont** embedding (serving the file to browsers), which
    is a separate grant from desktop use;
  - does it permit **redistribution of the file**, which is what committing it
    to a public repository is.

This repository is public. If the second is not granted, the file wants
serving from somewhere that is not a git remote — or the repository wants to
be private.
