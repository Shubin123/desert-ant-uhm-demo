# Uhm browser demo

[Open the live demo](https://shubin123.github.io/desert-ant-uhm-demo/)

Explore filler-word detection with the original Uhm weights by Desert Ant Labs.

Powered by [Desert Ant Labs](https://desertant.com) 🐜. The model, weights, and SDK are by Desert Ant Labs B.V.; this independent demo is maintained by Shubin123. See [ATTRIBUTION.md](ATTRIBUTION.md) and the [SDK license](https://license.desertant.com/1.0).

## Run locally

Serve the site directory over HTTP:

```sh
python3 -m http.server 8080 --directory site
```

Open http://localhost:8080. No build step or backend is required. Original model weights and the pinned ONNX runtime download on first inference. Microphone capture requires localhost or HTTPS. This independent browser pipeline does not use the Apple SDK or send usage telemetry.

## Deployment

The GitHub Actions workflow publishes the site directory to GitHub Pages on pushes to main. Choose GitHub Actions as the Pages source.

## Experimental adaptation

Uhm has no published browser SDK. This app runs the original v1.1.0 ONNX weights and adapts the upstream detector: 16 kHz mono, normalized 30-second windows with a 25-second hop, averaged overlap, a 0.5 filler threshold, 100 ms minimum runs and gap merging. Filler subtype is taken from the frame classifier rather than Apple's separate type-labeler. This is not an official SDK or a claim of parity with Apple's runtime.

## Upstream

- [SDK documentation](https://github.com/Desert-Ant-Labs/desert-ant-core/blob/main/docs/models/uhm.md)
- [Original model](https://huggingface.co/desert-ant-labs/uhm)
- [Desert Ant Labs](https://desertant.com)

Experimental browser adaptation. First use downloads the 94 MB ONNX model. English speech works best; type labels are secondary.
