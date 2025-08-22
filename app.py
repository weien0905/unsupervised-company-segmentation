from flask import Flask, request, jsonify, render_template
import pandas as pd
from sklearn.manifold import TSNE

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    file = request.files["file"]
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    df = pd.read_csv(file)

    # Ensure "name" column exists
    if "name" not in df.columns or "label" not in df.columns:
        return jsonify({"error": "CSV must contain a 'name' and 'label' column"}), 400

    # Keep only numeric columns
    features = df.drop(columns=["name", "label"])

    # Run t-SNE
    n_samples = features.shape[0]
    tsne = TSNE(n_components=2, random_state=42, perplexity=30)
    reduced = tsne.fit_transform(features.values)

    df["tsne_x"] = reduced[:, 0]
    df["tsne_y"] = reduced[:, 1]

    return jsonify({
        "names": df["name"].tolist(),
        "labels": df["label"].tolist(),
        "features": features.to_dict(orient="list"),
        "tsne_x": df["tsne_x"].tolist(),
        "tsne_y": df["tsne_y"].tolist()
    })

if __name__ == "__main__":
    app.run(debug=True)
