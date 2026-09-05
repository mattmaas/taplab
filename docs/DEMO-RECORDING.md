# Recording the demo GIF

A 30–45 second screen capture is worth more than the whole README to a first-time visitor.
Target file: `docs/media/demo.gif` (≤ 8 MB so GitHub renders it inline) plus the source
`demo.mp4`.

## Shot list (one take, no cuts needed)

| # | Seconds | On screen | What it proves |
|---|---|---|---|
| 1 | 0–5 | TapLab Companion main screen: status pill **Connected**, Tap Code **ON**. | App is real and talking to hardware. |
| 2 | 5–18 | Switch to any notes app. Tap `h e l l o` in Thumb-Free Tap Code (Middle→Ring, Index→Ring+Pinky, Ring→Middle ×2, Ring→Ring+Pinky). Text appears at the caret. | System-wide typing, not an in-app toy. |
| 3 | 18–26 | Raise hand into AirMouse posture, move cursor to a button, index-to-thumb tap → click. Two-finger swipe → scroll. | AirMouse override. |
| 4 | 26–40 | Open **Trainer**, run 3–4 prompts of a lesson; show the accuracy bar and a weak-character hint updating. | Data-driven training loop. |
| 5 | 40–45 | Back to main screen; toggle Tap Code **OFF**; stock keyboard types normally. | Non-destructive. |

Keep the Tap Strap in frame (a phone-camera picture-in-picture is ideal but optional).

## Capture

Screen only, via `scrcpy` (records at device resolution, no root needed):

```bash
scrcpy --record demo.mp4 --max-size 1080 --no-audio --stay-awake
# … perform the shot list, then Ctrl+C
```

Optional hand cam: record on a second phone and composite later; or skip it — the caret
moving in another app is the money shot.

## Convert to GIF

```bash
ffmpeg -i demo.mp4 -t 45 -vf "fps=15,scale=540:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" docs/media/demo.gif
```

If it exceeds ~8 MB, drop `fps=12` or `scale=480`. Also keep `demo.mp4` for the release notes /
LinkedIn post — video embeds beat GIFs everywhere except the GitHub README.

## Wire it into the README

Directly under the top-level `# TapLab` heading:

```markdown
![Thumb-Free Tap Code typing system-wide on Android](docs/media/demo.gif)
```
