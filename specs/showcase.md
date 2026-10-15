# Facet — Showcase

The finished game ships a showcase: the store-page presentation a player reads
before deciding to play. It is a `showcase/` directory at the root of this
repository, committed with the rest of the project, holding a description of the
game and a short carousel of captured media. This file defines its contents.

## Layout

Every file of the showcase sits directly in `showcase/`, with no subdirectories:

- `showcase/showcase.md`, the description.
- `showcase/showcase.toml`, the carousel.
- The media files the carousel and the description name.

## The description

`showcase/showcase.md` is Markdown written for a player: what Facet is, how a
board is cleared by swapping neighboring gems into runs, how strain builds on
the stones left standing and what spending it does, and what the three cuts
offer. Three to five short paragraphs. It is strictly about playing the game;
implementation, architecture, and tooling stay out of it. It may embed images
that sit beside it, referenced by bare relative path (for example
`![The board](board.png)`); every image it embeds is a `.png` in `showcase/`.

## The carousel

`showcase/showcase.toml` lists the media in the order they are presented, one
`[[media]]` table per entry:

```toml
[[media]]
file = "chain.json.gz"
name = "A chain running after one swap"

[[media]]
file = "title.png"
name = "The title screen"
```

- `file` names a file directly in `showcase/`, with no path separators. Every
  file the carousel names exists there, and each stays under 25 MiB.
- `name` is a caption of a few words.
- The carousel holds two to four entries. The first entry leads, so it carries
  the strongest view of live play.

## Media

The file extension states what an entry is:

| Extension | Media |
| --- | --- |
| `.png` | A screenshot of the running game. |
| `.json.gz` | A replay: a gzipped recording of the game's own drawing, made with the engine's recorder. |
| `.webm` | A video clip. |

Anything in motion is captured as a replay rather than a video.

## Capturing a replay

A replay is a gzipped JSON recording made with the engine's recorder, which the
engine documents in `engine/recording.md` at the root of this repository. Each
replay holds a few seconds of live play, such as a swap touching off a chain
that runs through several steps, rather than a menu. How screenshots and replays
are captured is the build's own business.
