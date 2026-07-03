# IronQuest — Gamified Anemia Management (Static Website Demo)

This repository contains a static demo website for IronQuest, a concept app that combines image-based anemia sign detection, natural remedy guidance, and a gamified experience for adolescents.

## Contents
- `index.html` — main website (demo)
- `assets/css/style.css` — styles
- `assets/js/app.js` — frontend logic and simulated detection
- `model/model_placeholder.h5` — placeholder ML model file (replace with your trained Keras .h5 model)
- `README.md` — this file
- `LICENSE` — MIT license

## Important notes
1. **This is a demo.** The detection shown on the site is simulated. Do not use this repository for clinical diagnosis.
2. To enable real inference you can:
   - Host a backend server (Flask, FastAPI, or Node/Express) that loads the Keras `.h5` model and exposes a `/predict` REST endpoint. The frontend can send the image via `fetch` to get predictions.
   - Or convert the Keras model to TensorFlow.js format using `tensorflowjs_converter` and run inference in the browser.

## Quick steps to add a real model (server approach)
1. Create a server (example with Flask):
   ```py
   from flask import Flask, request, jsonify
   from tensorflow.keras.models import load_model
   import numpy as np
   # load model: model = load_model('model/model_placeholder.h5')
   # implement image preprocessing and prediction, then return JSON
   ```
2. Replace the simulated block in `assets/js/app.js` with a `fetch('/predict', ...)` call.
3. Deploy the backend where the website can reach it (same domain or via CORS).

## Steps to host on GitHub Pages
1. Create a new GitHub repository.
2. Commit and push all files in this folder to the repository root.
3. In the repository settings, enable GitHub Pages and select the `main` branch and the root folder as the site source.
4. After a short time GitHub will publish your site at `https://<your-username>.github.io/<repo-name>/`.

## Replacing the placeholder model
- The file `model/model_placeholder.h5` is a placeholder text file. Replace it with your trained Keras `.h5` model or use a server to host your real model.

## License
MIT

---

If you want, I can also:
- Create a minimal Flask API to load a real `.h5` model and expose `/predict`.
- Convert instructions to TensorFlow.js conversion commands.
- Expand the game front end to a working PWA with local storage and mocked supplement logging.

