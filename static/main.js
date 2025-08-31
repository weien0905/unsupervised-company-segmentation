const fileInput = document.getElementById("csvFile");
const plotDiv = document.getElementById("plot");
const pointDetails = document.getElementById("pointDetails");
const clusterDetails = document.getElementById("clusterDetails");
const loading = document.getElementById("loading");
const featuresBtn = document.getElementById("sortFeaturesBtn");
const clusterButtonsDiv = document.getElementById("clusterButtons");
const geminiKeyInput = document.getElementById("geminiKey");
const clusterAnalysis = document.getElementById("clusterAnalysis");
const dataPointsCollapse = document.getElementById("dataPointsCollapse");
const searchInput = document.getElementById("searchInput");
const searchSuggestions = document.getElementById("searchSuggestions");
const spinner = document.getElementById("loading");

function handleRun() {
    const file = fileInput.files[0];

    if (!file) {
        alert("Please upload a CSV file first.");
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    // Get user selections
    formData.append("capping", document.getElementById("capping").value);
    formData.append("scaler", document.getElementById("scaler").value);
    formData.append("reduction", document.getElementById("reduction").value);
    formData.append("n_components", document.getElementById("n_components").value);
    formData.append("clustering", document.getElementById("clustering").value);
    formData.append("n_clusters", document.getElementById("n_clusters").value);

    // Show spinner
    loading.style.display = "block";

    fetch("/upload", {
    method: "POST",
    body: formData
    })
    .then(res => res.json())
    .then(data => {
    loading.style.display = "none";
    if (data.error) {
        alert(data.error);
        return;
    }
    plotData(data);
    })
    .catch(err => {
    loading.style.display = "none";
    });
}

function plotData(data) {
    document.getElementById("dataPointsSection").classList.remove("section-locked");
    document.getElementById("clustersSection").classList.remove("section-locked");
    featuresBtn.disabled = false;

    const clusters = data.clusters;
    const uniqueClusters = [...new Set(clusters)].sort((a, b) => a - b);

    // Set2 palette
    const colors = [
    "#66c2a5","#fc8d62","#8da0cb","#e78ac3",
    "#a6d854","#ffd92f","#e5c494","#b3b3b3"
    ];

    clusterButtonsDiv.innerHTML = "";

    uniqueClusters.forEach((cl, i) => {
    const btn = document.createElement("button");
    btn.className = "btn btn-sm me-2 mb-2";
    btn.style.backgroundColor = colors[cl % colors.length];
    btn.style.color = "white";
    btn.textContent = `Cluster ${cl}`;
    btn.onclick = () => showClusterMean(cl);
    clusterButtonsDiv.appendChild(btn);
    });

    function showClusterMean(clusterId) {
    clusterDetails.style.display = "block";

    if (!document.getElementById("barsContainerCluster")) {
        clusterDetails.innerHTML = `
        <h3 class="mb-2">Cluster <span id="clusterId"></span> Mean</h3>
        <div id="barsContainerCluster"></div>
        `;
    }

    document.getElementById("clusterId").textContent = clusterId;

    const idxs = clusters.map((c, i) => c === clusterId ? i : -1).filter(i => i !== -1);
    if (idxs.length === 0) {
        clusterDetails.innerHTML += "<p>No data for this cluster.</p>";
        return;
    }

    const means = {};
    for (const [feature, values] of Object.entries(data.features)) {
        const subset = idxs.map(i => values[i]);
        const meanVal = subset.reduce((a, b) => a + b, 0) / subset.length;
        means[feature] = meanVal;
    }

    const barsContainer = document.getElementById("barsContainerCluster");

    for (const [feature, meanVal] of Object.entries(means)) {
        const allVals = data.features[feature];
        const sorted = [...allVals].sort((a, b) => a - b);
        const rank = sorted.indexOf(
        sorted.reduce((prev, curr) =>
            Math.abs(curr - meanVal) < Math.abs(prev - meanVal) ? curr : prev
        )
        ) / (sorted.length - 1);
        const percentile = Math.round(rank * 100);

        let barWrapper = barsContainer.querySelector(`[data-feature="${feature}"]`);
        if (!barWrapper) {
        barWrapper = document.createElement("div");
        barWrapper.className = "mb-2";
        barWrapper.setAttribute("data-feature", feature);
        barWrapper.innerHTML = `
            <div class="d-flex justify-content-between">
            <span><strong>${feature}</strong>: <span class="val">${meanVal.toFixed(3)}</span></span>
            <span class="pct">${percentile}th %</span>
            </div>
            <div class="progress" style="height: 12px;">
            <div class="progress-bar cluster-bg" role="progressbar" 
                style="width: 0%; background-color: ${colors[clusterId]}" aria-valuenow="${percentile}" aria-valuemin="0" aria-valuemax="100"></div>
            </div>
        `;
        barsContainer.appendChild(barWrapper);
        } 

        barWrapper.querySelector(".val").textContent = meanVal.toFixed(3);
        barWrapper.querySelector(".pct").textContent = `${percentile}th %`;
        barWrapper.querySelector(".cluster-bg").style.backgroundColor = colors[clusterId];

        const bar = barWrapper.querySelector(".progress-bar");
        const newWidth = percentile + "%";
        requestAnimationFrame(() => {
        bar.style.transition = "width 1s ease-in-out";
        bar.style.width = newWidth;
        });
    }

    clusterDetails.appendChild(barsContainer);

    clusterDetails.dataset.clusterId = clusterId;
    clusterDetails.dataset.means = JSON.stringify(means);
    }

    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) geminiKeyInput.value = savedKey;

    document.getElementById("saveGeminiKey").onclick = () => {
    localStorage.setItem("gemini_api_key", geminiKeyInput.value.trim());
    alert("Gemini API Key saved!");
    };

    document.getElementById("analyseClustersBtn").onclick = async () => {
    const apiKey = localStorage.getItem("gemini_api_key");
    if (!apiKey) {
        alert("Please enter and save your Gemini API key first.");
        return;
    }

    // Get means for all clusters
    const clusterMeans = {};
    uniqueClusters.forEach(cl => {
        const idxs = clusters.map((c, i) => c === cl ? i : -1).filter(i => i !== -1);
        const means = {};
        for (const [feature, values] of Object.entries(data.features)) {
        const subset = idxs.map(i => values[i]);
        const meanVal = subset.reduce((a, b) => a + b, 0) / subset.length;
        means[feature] = meanVal;
        }
        clusterMeans[`Cluster ${cl}`] = means;
    });

    const prompt = `In short summary, analyse these clusters based on their mean values:\n\n${JSON.stringify(clusterMeans, null, 2)}`;
    
    clusterAnalysis.style.display = "block";
    clusterAnalysis.textContent = "Analysing with Gemini...";

    try {
        const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + apiKey,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
            })
        }
        );

        const result = await response.json();
        const outputEl = document.getElementById("clusterAnalysis");

        if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const mdText = result.candidates[0].content.parts[0].text;
        outputEl.innerHTML = marked.parse(mdText);
        } else {
        outputEl.textContent = "No response from Gemini.";
        }
    } catch (err) {
        document.getElementById("clusterAnalysis").textContent = "Error calling Gemini API.";
    }
    };

    const traces = uniqueClusters.map((cl, i) => {
    const idxs = [];
    clusters.forEach((c, idx) => { if (c === cl) idxs.push(idx); });

    return {
        x: idxs.map(idx => data.tsne_x[idx]),
        y: idxs.map(idx => data.tsne_y[idx]),
        mode: "markers",
        type: "scattergl",
        name: "Cluster " + cl,
        text: idxs.map(idx => data.names[idx]),
        customdata: idxs,
        hovertemplate:
        "<b>%{text}</b><br>" +
        "Cluster: " + cl + "<br>" +
        "t-SNE X: %{x}<br>" +
        "t-SNE Y: %{y}<extra></extra>",
        marker: { size: 10, color: colors[cl % colors.length] }
    };
    });

    const layout = {
    margin: { t: 20 },
    xaxis: { title: "t-SNE X" },
    yaxis: { title: "t-SNE Y" },
    hovermode: "closest",
    hoverdistance: 20,
    dragmode: "pan"
    };

    Plotly.newPlot(plotDiv, traces, layout, { scrollZoom: true });

    if (plotDiv.removeAllListeners) plotDiv.removeAllListeners('plotly_click');

    function updateDetails(originalIndex) {
        pointDetails.style.display = "block";
        const bsCollapse = new bootstrap.Collapse(dataPointsCollapse, { toggle: false });
        bsCollapse.show();

        if (!document.getElementById("barsContainer")) {
            pointDetails.innerHTML = `
            <h3 class="mb-2" id="pointName"></h3>
            <div><strong>Cluster:</strong> <span id="pointCluster"></span></div>
            <div id="barsContainer"></div>
            `;
        }

        document.getElementById("pointName").textContent = data.names[originalIndex];
        document.getElementById("pointCluster").textContent = data.clusters[originalIndex];

        const barsContainer = document.getElementById("barsContainer");

        for (const [feature, values] of Object.entries(data.features)) {
            const val = values[originalIndex];
            const sorted = [...values].sort((a, b) => a - b);
            const rank = sorted.indexOf(val) / (values.length - 1);
            const percentile = Math.round(rank * 100);

            let barWrapper = barsContainer.querySelector(`[data-feature="${feature}"]`);
            if (!barWrapper) {
            barWrapper = document.createElement("div");
            barWrapper.className = "mb-2";
            barWrapper.setAttribute("data-feature", feature);
            barWrapper.innerHTML = `
                <div class="d-flex justify-content-between">
                <span><strong>${feature}</strong>: <span class="val">${val}</span></span>
                <span class="pct">${percentile}th %</span>
                </div>
                <div class="progress" style="height: 12px;">
                <div class="progress-bar bg-info" role="progressbar" 
                    style="width: 0%" aria-valuenow="${percentile}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
            `;
            barsContainer.appendChild(barWrapper);
            }

            barWrapper.querySelector(".val").textContent = val;
            barWrapper.querySelector(".pct").textContent = `${percentile}th %`;

            const bar = barWrapper.querySelector(".progress-bar");
            const newWidth = percentile + "%";
            requestAnimationFrame(() => {
            bar.style.transition = "width 1s ease-in-out";
            bar.style.width = newWidth;
            });
        }
    }

    plotDiv.on("plotly_click", function(event) {
    const originalIndex = event.points[0].customdata;
    updateDetails(originalIndex);
    });

    // Search functionality
    document.getElementById("searchBtn").addEventListener("click", handleSearch);
    document.getElementById("searchInput").addEventListener("keypress", function(e) {
    if (e.key === "Enter") handleSearch();
    });

    function handleSearch() {
    const query = document.getElementById("searchInput").value.trim().toLowerCase();
    if (!query) return;

    const idx = data.names.findIndex(name => name.toLowerCase().includes(query));
    if (idx === -1) {
        alert("Company not found.");
        return;
    }

    const xVal = data.tsne_x[idx];
    const yVal = data.tsne_y[idx];

    Plotly.relayout(plotDiv, {
        "xaxis.range": [xVal - 5, xVal + 5],
        "yaxis.range": [yVal - 5, yVal + 5]
    });

    Plotly.Fx.hover(plotDiv, [
        { curveNumber: 0, pointNumber: idx }
    ]);

    updateDetails(idx);
    }

    searchInput.addEventListener("input", function() {
    const query = this.value.trim().toLowerCase();
    searchSuggestions.innerHTML = "";

    if (!query) {
        searchSuggestions.style.display = "none";
        return;
    }

    // Find matches
    const matches = data.names
        .map((name, i) => ({ name, index: i }))
        .filter(item => item.name.toLowerCase().includes(query))
        .slice(0, 10); // show max 10 suggestions

    if (matches.length === 0) {
        searchSuggestions.style.display = "none";
        return;
    }

    // Show matches
    matches.forEach(item => {
        const option = document.createElement("button");
        option.className = "list-group-item list-group-item-action";
        option.textContent = item.name;
        option.onclick = () => {
            searchInput.value = item.name;
            searchSuggestions.style.display = "none";
        };
        searchSuggestions.appendChild(option);
    });

    searchSuggestions.style.display = "block";
    });

    document.addEventListener("click", function(e) {
    if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
        searchSuggestions.style.display = "none";
    }
    });

    document.getElementById("exportClustersBtn").onclick = () => {
    const featureNames = Object.keys(data.features);
    const headers = ["Name", "Cluster", ...featureNames];

    const rows = data.names.map((name, i) => [
        name,
        data.clusters[i],
        ...featureNames.map(f => data.features[f][i])
    ]);

    let csvContent = "data:text/csv;charset=utf-8,"
        + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "clusters.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    };

    featuresBtn.onclick = async () => {
    spinner.style.display = "block";
    clusterDetails.style.display = "none";
    pointDetails.style.display = "none";

    try {
        const response = await fetch("/feature_importance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            features: data.features,
            clusters: data.clusters
        })
        });

        const result = await response.json();
        if (result.error) {
        alert(result.error);
        return;
        }

        const sortedFeatures = result.sorted_features;

        const reordered = {};
        sortedFeatures.forEach(f => {
        reordered[f] = data.features[f];
        });
        data.features = reordered;

        pointDetails.innerHTML = "";
        document.getElementById("clusterDetails").innerHTML = "";
        alert("Features sorted by importance successfully.");

    } catch (err) {
        alert("Error");
    } finally {
        spinner.style.display = "none";
    }
    };
}

document.getElementById("runBtn").addEventListener("click", handleRun);