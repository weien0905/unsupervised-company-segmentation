from flask import Flask, request, jsonify, render_template
import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler, MinMaxScaler
from sklearn.decomposition import PCA
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.manifold import TSNE
from pyclustering.cluster.kmedoids import kmedoids
from pyclustering.utils import calculate_distance_matrix
import random
import tensorflow as tf
from tensorflow.keras.models import Model
from tensorflow.keras.layers import Input, Dense
from tensorflow.keras.optimizers import Adam
from tensorflow.keras.callbacks import EarlyStopping
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier

app = Flask(__name__)

random.seed(42)
np.random.seed(42)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    file = request.files["file"]
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    # Parse options from request form
    capping = request.form.get("capping", "none")
    scaling = request.form.get("scaling", "standard")
    reduction = request.form.get("reduction", "pca")
    n_components = int(request.form.get("n_components", 2))
    clustering = request.form.get("clustering", "kmeans")
    n_clusters = int(request.form.get("n_clusters", 3))

    df = pd.read_csv(file)

    non_numeric_cols = df.select_dtypes(exclude=['number']).columns.tolist()

    if len(non_numeric_cols) == 0:
        return jsonify({"error": "CSV must contain exactly one non-numeric column."}), 400
    elif len(non_numeric_cols) > 1:
        return jsonify({"error": f"CSV must contain exactly one non-numeric column, but found: {non_numeric_cols}"}), 400

    id_column = non_numeric_cols[0]

    # Drop id column for preprocessing
    features = df.drop(columns=[id_column])

    # 1. Outlier Capping
    if capping != "none":
        if capping == "1_99":
            lower_q, upper_q = 0.01, 0.99
        elif capping == "5_95":
            lower_q, upper_q = 0.05, 0.95

        if lower_q is not None:
            for col in features.columns:
                lower_bound = features[col].quantile(lower_q)
                upper_bound = features[col].quantile(upper_q)
                features[col] = features[col].clip(lower_bound, upper_bound)

    # 2. Scaling
    if scaling == "standard":
        scaler = StandardScaler()
    else:
        scaler = MinMaxScaler()
    scaled = scaler.fit_transform(features)

    # 3. Dimensionality Reduction
    if reduction == "pca":
        n_comp = min(n_components, scaled.shape[1])
        reducer = PCA(n_components=n_comp, random_state=42)
        reduced = reducer.fit_transform(scaled)

    elif reduction == "autoencoder":
        SEED = 42
        random.seed(SEED)
        np.random.seed(SEED)
        tf.random.set_seed(SEED)

        input_dim = scaled.shape[1]
        encoding_dim = n_components
        X_train, X_val = train_test_split(scaled, test_size=0.2, random_state=SEED)

        train_dataset = tf.data.Dataset.from_tensor_slices((X_train, X_train))
        train_dataset = train_dataset.shuffle(buffer_size=len(X_train), seed=SEED).batch(32)

        input_layer = Input(shape=(input_dim,))
        x = Dense(10, activation='relu')(input_layer)
        x = Dense(8, activation='relu')(x)
        bottleneck = Dense(encoding_dim, activation='linear')(x)
        x = Dense(8, activation='relu')(bottleneck)
        x = Dense(10, activation='relu')(x)
        decoded = Dense(input_dim, activation='linear')(x)

        autoencoder = Model(inputs=input_layer, outputs=decoded)
        autoencoder.compile(optimizer=Adam(0.002), loss='mse')

        early_stop = EarlyStopping(
            monitor='val_loss',
            patience=15,
            restore_best_weights=True
        )

        autoencoder.fit(
            train_dataset,
            epochs=300,
            batch_size=32,
            shuffle=True,
            validation_data=(X_val, X_val),
            callbacks=[early_stop],
            verbose=0
        )

        encoder = Model(inputs=autoencoder.input, outputs=bottleneck)
        reduced = encoder.predict(scaled)

    # 4. Clustering
    if clustering == "kmeans":
        model = KMeans(n_clusters=n_clusters, random_state=42)
        labels = model.fit_predict(reduced)

    elif clustering == "ahc":
        model = AgglomerativeClustering(n_clusters=n_clusters)
        labels = model.fit_predict(reduced)

    elif clustering == "kmedoids":
        dist_matrix = calculate_distance_matrix(reduced)
        init_medoids = random.sample(range(len(reduced)), n_clusters)
        model = kmedoids(dist_matrix, init_medoids, data_type='distance_matrix')
        model.process()
        clusters = model.get_clusters()
        labels = np.zeros(len(reduced), dtype=int)
        for idx, cluster in enumerate(clusters):
            for i in cluster:
                labels[i] = idx
    else:
        return jsonify({"error": "Invalid clustering method"}), 400

    df["cluster"] = labels

    # 5. t-SNE for visualization
    tsne = TSNE(n_components=2, random_state=42, perplexity=30)
    reduced = tsne.fit_transform(reduced)

    df["tsne_x"] = reduced[:, 0]
    df["tsne_y"] = reduced[:, 1]

    return jsonify({
        "names": df[id_column].tolist(),
        "clusters": df["cluster"].tolist(),
        "features": features.to_dict(orient="list"),
        "tsne_x": df["tsne_x"].tolist(),
        "tsne_y": df["tsne_y"].tolist()
    })

@app.route("/feature_importance", methods=["POST"])
def feature_importance():
    try:
        data = request.json
        features = pd.DataFrame(data["features"])
        clusters = data["clusters"]

        rf = RandomForestClassifier(random_state=42)
        rf.fit(features, clusters)

        importances = rf.feature_importances_
        feature_names = list(features.columns)

        sorted_features = [f for _, f in sorted(zip(importances, feature_names), reverse=True)]

        return jsonify({"sorted_features": sorted_features})

    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)
