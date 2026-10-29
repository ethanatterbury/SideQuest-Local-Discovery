# Offline photograph vision pilot

This is a measured research pilot for a free local CPU classifier to help recognize ordinary venue photographs whose filenames do not describe their contents. It does not approve or publish photographs, change the production photo policy, or establish England photo coverage.

The isolated package in `scripts/photo-vision/` pins Transformers.js 3.8.1 and the quantized (`q8`) `Xenova/clip-vit-base-patch32` model at immutable revision `d15189d7028b43f1d3e65039190477f6af591c2a`. The model requires roughly 154 MB of ONNX weights plus tokenizer/configuration files. The model runs locally without an inference API key or per-image API quota. Model downloads, CPU time, source fetching and CI minutes still have practical limits. Nothing is added to the Next.js or Vercel runtime dependencies.

`dataset.json` freezes 26 previously reviewed archived WebP renditions: 20 ordinary physical-place scenes, five rejected subjects, and one borderline playground framing. Labels preserve the actual review descriptions, rendition SHA-256, publisher/source URL, credit and existing rights statement. These are **rendition hashes**, not hashes of original publisher files. The convenience sample is small, local and predominantly outdoors; it cannot establish a national false-accept rate. Five negative examples are especially insufficient for an accuracy promise.

The rejects include Monkey Mates' illustration, Rushmoor's award portrait, Physique Architect's template portrait, a posed construction team, and Camberley Theatre's car park. The car park is correctly labelled a real photograph but unsuitable as a representative venue scene. The restaurant crowd is a genuine physical venue photograph even though an earlier collection deferred it outside that collection's activity focus. Evergreen Road Playground is retained as a borderline diagnostic, rather than presenting an ambiguous composition as unambiguous ground truth.

Run from the repository root:

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --prefix scripts/photo-vision
npm run validate --prefix scripts/photo-vision
npm run benchmark --prefix scripts/photo-vision
# Repeat using only already cached model files:
npm run benchmark --prefix scripts/photo-vision -- --offline
```

Validation reads the repository archives and checks metadata and exact reviewed bytes without loading dependencies or contacting a publisher. Benchmarking downloads only the pinned model on the first run; all images come from existing local archives. Image renditions exist only in a temporary directory during inference and are removed in `finally`. Only model files are cached. The report contains metadata and scores, never image bytes. No inference requests or photos are sent to a hosted vision service. The managed workspace currently does not permit Hugging Face model downloads; the first real CPU measurement therefore runs in the scoped GitHub Actions workflow, not in this workspace.

The workflow runs on manual dispatch and main pushes that change its own files. It uploads `report.json` for 14 days, including every prompt score, decision, margin, expected label, source/rights evidence, per-image time, model load time, CPU/runtime, peak memory, confusion matrices, false accepts and abstentions. Serial projections for 1,000 and 100,000 images exclude image fetching and source/identity verification. The default exploratory threshold is preregistered at a maximum venue-class score of 0.5 with a 0.15 lead over the best rejection class. A calibration-only threshold grid is reported separately from the frozen holdout results; it never selects or installs a production threshold. Inspect the resulting artifact before drawing an accuracy or throughput conclusion.

CLIP compares an image with generic text prompts. Scores depend on the other prompts and are **not calibrated probabilities**, captions, venue-name recognition or identity verification. A plausible physical venue scene still needs independent publisher/branch identity, image URL availability, representative composition and source/rights checks. The classifier cannot grant reuse permission or justify hosting publisher images. No example-specific names, URLs or IDs enter its prompts or decision function.

Primary sources: [Transformers.js Node documentation](https://huggingface.co/docs/transformers.js/v3.8.1/tutorials/node), [CLIP model usage](https://huggingface.co/Xenova/clip-vit-base-patch32), [pinned model commit](https://huggingface.co/Xenova/clip-vit-base-patch32/commit/d15189d7028b43f1d3e65039190477f6af591c2a), [ONNX model files](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/d15189d7028b43f1d3e65039190477f6af591c2a/onnx), [Transformers.js Apache-2.0 license](https://github.com/huggingface/transformers.js/blob/3.8.1/LICENSE), [upstream CLIP MIT license](https://github.com/openai/CLIP/blob/main/LICENSE).
