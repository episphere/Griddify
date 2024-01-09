import {
  showRawDataSidebar,
  showVirtualGridSidebar,
  highlightTab,
  showImageSegmentationSidebar,
  updateSliderUIText,
  updateStatusMessage,
  resetApplication,
  makeElementDraggable,
} from "./UI.js";

import {
  saveUpdatedCores,
  preprocessForTravelingAlgorithm,
} from "./data_processing.js";

import { preprocessCores } from "./delaunay_triangulation.js";

import {
  applyAndVisualizeTravelingAlgorithm,
  updateVirtualGridSpacing,
  redrawCoresForTravelingAlgorithm,
  obtainHyperparametersAndDrawVirtualGrid,
} from "./drawCanvas.js";

import { loadModel, runPipeline, loadOpenCV } from "./core_detection.js";

// Initialize image elements
const originalImageContainer = document.getElementById("originalImage");
const processedImageCanvasID = "segmentationResultsCanvas";

// Load dependencies and return updated state
const loadDependencies = async () => ({
  model: await loadModel("./tfjs_model/model.json"),
  openCVLoaded: await loadOpenCV(),
});

// Pure function to get input values
const getInputValue = (inputId) => document.getElementById(inputId).value;

// Event handler for file input change
const handleImageInputChange = async (e, processCallback) => {
  resetApplication();

  // Show loading spinner
  document.getElementById("loadingSpinner").style.display = "block";

  const file = e.target.files[0];
  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = async (event) => {
      originalImageContainer.src = event.target.result;
      originalImageContainer.onload = async () => {
        // If the image's width or height is greater than 1024, then alert an error and exit
        if (
          originalImageContainer.width > 1024 ||
          originalImageContainer.height > 1024
        ) {
          alert(
            "Image dimensions are too large. Please select an image that is less than 1024 x 1024."
          );
          return;
        }

        updateStatusMessage(
          "imageLoadStatus",
          "Image loaded successfully.",
          "success-message"
        );
        processCallback();

        window.loadedImg = originalImageContainer;
      };

      originalImageContainer.onerror = () => {
        updateStatusMessage(
          "imageLoadStatus",
          "Image failed to load.",
          "error-message"
        );

        console.error("Image failed to load.");
      };
    };
    reader.readAsDataURL(file);
  } else {
    updateStatusMessage(
      "imageLoadStatus",
      "File loaded is not an image.",
      "error-message"
    );

    console.error("Image failed to load.");
  }
};

function handleMetadataFileSelect(event) {
  const file = event.target.files[0];

  if (!file) {
    updateStatusMessage(
      "metadataLoadStatus",
      "No file selected.",
      "error-message"
    );
    return;
  }

  // Check file type
  const fileType = file.type;
  const validExcelTypes = [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];
  const validCsvType = "text/csv";

  if (!validExcelTypes.includes(fileType) && fileType !== validCsvType) {
    updateStatusMessage(
      "metadataLoadStatus",
      "Invalid file type. Please upload a .csv or .xls/.xlsx file.",
      "error-message"
    );
    return;
  }

  if (fileType === validCsvType) {
    processCSV(file);
  } else {
    processExcel(file);
  }
}

function processCSV(file) {
  Papa.parse(file, {
    complete: function (results) {
      validateMetadata(results.data);
    },
  });
}

function processExcel(file) {
  const reader = new FileReader();

  reader.onload = function (e) {
    const data = new Uint8Array(e.target.result);
    const workbook = XLSX.read(data, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const json = XLSX.utils.sheet_to_json(worksheet);
    validateMetadata(json);
  };

  reader.readAsArrayBuffer(file);
}

function validateMetadata(data) {
  if (!data || data.length === 0) {
    updateStatusMessage(
      "metadataLoadStatus",
      "The file is empty.",
      "error-message"
    );
    return;
  }

  // Helper function to find a column name considering case-insensitivity and abbreviations
  function findColumnName(data, possibleNames) {
    const columnNames = Object.keys(data[0]);
    for (const name of columnNames) {
      if (possibleNames.includes(name.toLowerCase())) {
        return name;
      }
    }
    return null;
  }

  // Define possible names for 'row' and 'column' considering case and abbreviations
  const possibleRowNames = ["row"];
  const possibleColumnNames = ["column", "col"];

  const rowName = findColumnName(data, possibleRowNames);
  const colName = findColumnName(data, possibleColumnNames);

  if (!rowName || !colName) {
    updateStatusMessage(
      "metadataLoadStatus",
      "Missing required columns: row and column/col.",
      "error-message"
    );
    return;
  }

  // Store the identified column names and the data
  window.metadataRowName = rowName;
  window.metadataColName = colName;
  window.userUploadedMetadata = data;

  updateStatusMessage(
    "metadataLoadStatus",
    "File successfully uploaded and validated.",
    "success-message"
  );
}

// Function to get input parameters from the UI
const getInputParameters = () => {
  const threshold = 1 - parseFloat(getInputValue("thresholdSlider"));
  const maskAlpha = parseFloat(getInputValue("maskAlphaSlider"));
  const minArea = parseInt(getInputValue("minAreaInput"), 10);
  const maxArea = parseInt(getInputValue("maxAreaInput"), 10);
  const disTransformMultiplier = parseFloat(
    getInputValue("disTransformMultiplierInput")
  );

  return {
    threshold,
    maskAlpha,
    minArea,
    maxArea,
    disTransformMultiplier,
  };
};

// Event handler for load image from URL
const handleLoadImageUrlClick = async (state) => {
  resetApplication();

  // Show loading spinner
  document.getElementById("loadingSpinner").style.display = "block";

  const imageUrl = getInputValue("imageUrlInput");

  if (imageUrl) {
    let imageResp = undefined
    if (imageUrl.endsWith(".png") || imageUrl.endsWith(".jpg")) {
      imageResp = fetch(imageUrl)
    } else {
      imageResp = getPNGFromWSI(imageUrl, MAX_DIMENSION)
    }
    imageResp.then((response) => {
      if (response.ok) {
        return response.blob();
      } else {
        updateStatusMessage(
          "imageLoadStatus",
          "Invalid image URL.",
          "error-message"
        );
        throw new Error("Network response was not ok.");
      }
    })
    .then((blob) => {
      let objectURL = URL.createObjectURL(blob);
      originalImageContainer.crossOrigin = "anonymous";
      originalImageContainer.src = objectURL;

      originalImageContainer.onload = async () => {
        // If the image's width or height is greater than 1024, then alert an error and exit
        if (
          originalImageContainer.width > 1024 ||
          originalImageContainer.height > 1024
        ) {
          alert(
            "Image dimensions are too large. Please select an image that is less than 1024 x 1024."
          );
          return;
        }

        window.loadedImg = originalImageContainer;

        updateStatusMessage(
          "imageLoadStatus",
          "Image loaded successfully.",
          "success-message"
        );
        await segmentImage();
      };
    })
    .catch((error) => {
      updateStatusMessage(
        "imageLoadStatus",
        "Invalid image URL.",
        "error-message"
      );
      console.error(
        "There has been a problem with your fetch operation: ",
        error
      );
    });
  } else {
    updateStatusMessage("imageLoadStatus", "Invalid Image.", "error-message");
    console.error("Please enter a valid image URL");
  }
};

async function segmentImage() {
  const { threshold, maskAlpha, minArea, maxArea, disTransformMultiplier } =
    getInputParameters();

  if (
    originalImageContainer.src &&
    originalImageContainer.src[originalImageContainer.src.length - 1] !== "#"
  ) {
    try {
      await runPipeline(
        originalImageContainer,
        window.state.model,
        threshold,
        minArea,
        maxArea,
        disTransformMultiplier,
        processedImageCanvasID,
        maskAlpha
      );

      window.preprocessedCores = preprocessCores(window.properties);

    } catch (error) {
      console.error("Error processing image:", error);
    } finally {
      // Hide loading spinner
      document.getElementById("loadingSpinner").style.display = "none";
    }
  }
}

function bindEventListeners() {
  // Event listener for the Apply Hyperparameters button
  document
    .getElementById("apply-hyperparameters")
    .addEventListener("click", applyAndVisualizeTravelingAlgorithm);

  document
    .getElementById("create-virtual-grid")
    .addEventListener("click", obtainHyperparametersAndDrawVirtualGrid);

  // Add event listeners for range inputs to show the current value
  document
    .getElementById("horizontalSpacing")
    .addEventListener("input", function () {
      document.getElementById("horizontalSpacingValue").textContent =
        this.value;
    });

  document
    .getElementById("verticalSpacing")
    .addEventListener("input", function () {
      document.getElementById("verticalSpacingValue").textContent = this.value;
    });

  // Add event listeners for range inputs to show the current value
  document.getElementById("startingX").addEventListener("input", function () {
    document.getElementById("startingXValue").textContent = this.value;
  });

  document.getElementById("startingY").addEventListener("input", function () {
    document.getElementById("startingYValue").textContent = this.value;
  });

  // Event listeners for tab buttons
  document
    .getElementById("rawDataTabButton")
    .addEventListener("click", function () {
      showRawDataSidebar();
      highlightTab(this); // This function will highlight the active tab, it's implementation is shown below
    });

  document
    .getElementById("imageSegmentationTabButton")
    .addEventListener("click", function () {
      showImageSegmentationSidebar();
      highlightTab(this); // This function will highlight the active tab, it's implementation is shown below
    });

  document
    .getElementById("virtualGridTabButton")
    .addEventListener("click", function () {
      showVirtualGridSidebar();
      highlightTab(this); // This function will highlight the active tab, it's implementation is shown below
    });

  // JavaScript to handle the virtual grid sidebar hyperparameters and update the grid
  document
    .getElementById("applyVirtualGridSettings")
    .addEventListener("click", function () {
      const horizontalSpacing = parseInt(
        document.getElementById("horizontalSpacing").value,
        10
      );
      const verticalSpacing = parseInt(
        document.getElementById("verticalSpacing").value,
        10
      );
      const startingX = parseInt(
        document.getElementById("startingX").value,
        10
      );
      const startingY = parseInt(
        document.getElementById("startingY").value,
        10
      );

      // Update the virtual grid with the new spacing values
      updateVirtualGridSpacing(
        horizontalSpacing,
        verticalSpacing,
        startingX,
        startingY
      );
    });

  document
    .getElementById("saveResults")
    .addEventListener("click", saveUpdatedCores);

  document
    .getElementById("toggle-advanced-settings")
    .addEventListener("click", function () {
      var advancedSettings = document.getElementById("advanced-settings");
      if (advancedSettings.style.display === "none") {
        advancedSettings.style.display = "block";
        this.textContent = "Hide Advanced Settings";
      } else {
        advancedSettings.style.display = "none";
        this.textContent = "Show Advanced Settings";
      }
    });

  document.getElementById("userRadius").addEventListener("input", function () {
    const radiusValue = document.getElementById("radiusValue");
    const userRadius = document.getElementById("userRadius").value;
    radiusValue.value = userRadius; // Update the output element with the slider value

    const imageFile = document.getElementById("fileInput").files[0];
    if ((imageFile || window.loadedImg) && window.preprocessedCores) {
      // If there's an image and cores data, draw the cores with the new radius
      redrawCoresForTravelingAlgorithm();

      // Change the defaultRadius value of each core in window.sortedCores to the new radius
      window.sortedCoresData.forEach((core) => {
        core.currentRadius = parseInt(userRadius);
      });
    } else {
      alert("Please load an image and JSON file first.");
    }
  });

  makeElementDraggable(document.getElementById("addSidebar"));
  makeElementDraggable(document.getElementById("editSidebar"));

  // Close the sidebar
  document.querySelectorAll(".close-button").forEach((button) => {
    button.addEventListener("click", function () {
      const sidebar = this.closest(".edit-sidebar");
      sidebar.style.display = "none"; // You can toggle visibility or minimize the sidebar as required
    });
  });

  document
    .getElementById("metadataFileInput")
    .addEventListener("change", handleMetadataFileSelect, false);

    // Select all close buttons
  const closeButtons = document.querySelectorAll('.close-instructions');

  // Add a click event listener to each close button
  closeButtons.forEach(function(button) {
    button.addEventListener('click', function() {
      // Hide the parent element of the clicked button
      this.parentElement.style.display = 'none';
    });
  });
}

// Initialize and bind events
const initSegmentation = async () => {
  const state = await loadDependencies();
  window.state = state;

  document
    .getElementById("fileInput")
    .addEventListener("change", (e) =>
      handleImageInputChange(e, () => segmentImage())
    );
  document
    .getElementById("loadImageUrlBtn")
    .addEventListener("click", () => handleLoadImageUrlClick(state));

  ["input", "change"].forEach((event) => {
    document
      .getElementById("thresholdSlider")
      .addEventListener(event, () => updateSliderUIText(state));
    document
      .getElementById("maskAlphaSlider")
      .addEventListener(event, () => updateSliderUIText(state));
  });
  document
    .getElementById("downloadSegmentationResults")
    .addEventListener("click", function () {
      // Assuming `properties` is the variable holding your segmentation results
      if (!window.properties) {
        alert("Algorithm has not run yet!");
        return;
      }

      const propertiesJson = JSON.stringify(window.properties, null, 2);
      const blob = new Blob([propertiesJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "segmentation-properties.json";
      a.click();
      URL.revokeObjectURL(url);
    });

  document
    .getElementById("applySegmentation")
    .addEventListener("click", async function () {
      // Assuming `properties` is the variable holding your segmentation results
      if (!window.properties) {
        alert("No image uploaded!");
        return;
      }

      window.actionHistory = [];
      await segmentImage();
    });

  document
    .getElementById("finalizeSegmentation")
    .addEventListener("click", async function () {
      // Assuming `properties` is the variable holding your segmentation results
      if (!window.properties) {
        alert("No image uploaded!");
        return;
      }

      preprocessForTravelingAlgorithm();
    });
};

// Main function that runs the application
const run = async () => {
  bindEventListeners();
  // Run the app
  initSegmentation();
};

run();
