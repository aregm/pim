# Rehearsal corpus

The five pieces the first-afternoon rehearsal (`npm run rehearsal`, specification section 7) captures. The files
stay out of git; this file says what each one is and how it was made, so the set can be rebuilt or replaced by
five real pieces of your own (keep the names, or pass `--corpus <dir>` with the same names).

| Piece      | File             | Remembered phrase | How it was made                                                                                                                 |
| ---------- | ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Web page   | (a URL)          | `system of lamps` | `https://en.wikipedia.org/wiki/Lighthouse` by default; `--url` and `--phrase` change it (a phrase from the text, not the title) |
| PDF        | `report.pdf`     | `quorum`          | `cupsfilter report.txt > report.pdf` over three lines about a vendor vote that needs a quorum of five members                   |
| Whiteboard | `whiteboard.jpg` | `harbour survey`  | Pillow drawing in the MarkerFelt font on a slightly rotated, blurred off-white board: a Q3 plan with four lines                 |
| Voice memo | `memo.aiff`      | `kiosk rollout`   | `say -v Samantha -o memo.aiff "Voice memo. The harbour survey moves to Friday. Bring the kiosk rollout notes …"`                |
| Video      | `video.mp4`      | `lighthouse`      | The Gate 3 sample: three scene cuts with a synthesized voice track that says "lighthouse" and "kiosk"                           |

Every phrase is found lexically, so no step of the rehearsal waits on a model.
