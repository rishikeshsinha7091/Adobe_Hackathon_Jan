/**
 * Main UI logic for the Color Extractor Adobe Express Add-on.
 * 
 * This file handles:
 * 1) Image upload and processing
 * 2) Dominant color extraction from images using a median cut quantization algorithm
 * 3) Display of extracted colors as a percentage-based palette bar
 * 4) Importing images onto the Adobe Express canvas using the Express SDK
 * 
 * The add-on uses Adobe Express's Add-on SDK which provides APIs to interact with
 * the Express editor canvas and document.
 */
import addOnUISdk from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

// Wait for the Adobe Express Add-on SDK to be ready before initializing
// This ensures all Express APIs are available for use
addOnUISdk.ready.then(async () => {
    console.log("addOnUISdk is ready for use.");

    // Get the UI runtime - provides access to communication with the document sandbox
    const { runtime } = addOnUISdk.instance;

    // Get the proxy object to call APIs defined in the Document Sandbox runtime
    // The sandbox runs in a separate context for security and can manipulate the document
    // Note: Currently unused in this add-on, but required for the SDK architecture
    const sandboxProxy = await runtime.apiProxy("documentSandbox");

    // Get references to UI elements that will be manipulated by event handlers
    const imageUpload = document.getElementById("imageUpload");
    const colorBar = document.getElementById("colorBar");
    const importButton = document.getElementById("importButton");
    
    // Validate that all required UI elements exist before proceeding
    // This prevents runtime errors if the HTML structure changes
    if (!imageUpload) {
        console.error("Image upload element not found!");
        return;
    }
    if (!colorBar) {
        console.error("Color bar element not found!");
        return;
    }
    if (!importButton) {
        console.error("Import button element not found!");
        return;
    }
    
    console.log("Elements found, setting up event listener...");

    /**
     * Calculates the Euclidean distance between two RGB colors in 3D color space.
     * Used to determine which dominant color a pixel is closest to.
     * 
     * @param {Array<number>} rgb1 - First color as [R, G, B] array (0-255)
     * @param {Array<number>} rgb2 - Second color as [R, G, B] array (0-255)
     * @returns {number} Distance between the two colors
     */
    function colorDistance(rgb1, rgb2) {
        const [r1, g1, b1] = rgb1;
        const [r2, g2, b2] = rgb2;
        return Math.sqrt(
            Math.pow(r2 - r1, 2) + Math.pow(g2 - g1, 2) + Math.pow(b2 - b1, 2)
        );
    }

    /**
     * Finds the index of the dominant color that is closest to a given pixel color.
     * Used when calculating color percentages to assign each pixel to its nearest dominant color.
     * 
     * @param {Array<number>} pixelRgb - Pixel color as [R, G, B] array
     * @param {Array<Array<number>>} dominantColors - Array of dominant colors, each as [R, G, B]
     * @returns {number} Index of the closest dominant color
     */
    function findClosestColor(pixelRgb, dominantColors) {
        let minDistance = Infinity;
        let closestIndex = 0;
        
        dominantColors.forEach((color, index) => {
            const distance = colorDistance(pixelRgb, color);
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        
        return closestIndex;
    }

    /**
     * Calculates the percentage of each dominant color in the image.
     * 
     * This function samples pixels from the full-resolution image and assigns each
     * pixel to its closest dominant color. The resulting percentages determine the
     * width of each color segment in the palette bar.
     * 
     * Uses sampling (every 10th pixel) for performance on large images, as processing
     * every pixel would be too slow for high-resolution images.
     * 
     * @param {HTMLImageElement} image - The loaded image element
     * @param {Array<Array<number>>} dominantColors - Array of dominant colors to match against
     * @returns {Promise<Array<number>>} Array of percentages corresponding to each dominant color
     */
    async function calculateColorPercentages(image, dominantColors) {
        return new Promise((resolve) => {
            // Create a canvas to extract pixel data from the image
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            // Use full image dimensions for accurate percentage calculation
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            ctx.drawImage(image, 0, 0);
            
            // Extract raw pixel data (RGBA format, 4 bytes per pixel)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            const colorCounts = new Array(dominantColors.length).fill(0);
            const totalPixels = canvas.width * canvas.height;
            
            // Sample every 10th pixel for performance optimization
            // This provides a good balance between accuracy and speed
            const sampleRate = 10;
            let sampledPixels = 0;
            
            // Iterate through pixels (RGBA = 4 bytes, so step by 4 * sampleRate)
            for (let i = 0; i < pixels.length; i += 4 * sampleRate) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const pixelRgb = [r, g, b];
                
                // Find which dominant color this pixel is closest to
                const closestIndex = findClosestColor(pixelRgb, dominantColors);
                colorCounts[closestIndex]++;
                sampledPixels++;
            }
            
            // Convert counts to percentages based on sampled pixels
            const percentages = colorCounts.map(count => 
                (count / sampledPixels) * 100
            );
            
            resolve(percentages);
        });
    }

    /**
     * Converts RGB color values to hexadecimal color code.
     * Used for displaying colors in CSS and tooltips.
     * 
     * @param {number} r - Red component (0-255)
     * @param {number} g - Green component (0-255)
     * @param {number} b - Blue component (0-255)
     * @returns {string} Hex color code (e.g., "#FF5733")
     */
    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }

    /**
     * Determines if a color is light or dark using perceived brightness.
     * Used to choose appropriate text color (black or white) for readability
     * when displaying percentage text on color segments.
     * 
     * Uses the standard luminance formula that accounts for human eye sensitivity
     * to different color channels (more sensitive to green).
     * 
     * @param {number} r - Red component (0-255)
     * @param {number} g - Green component (0-255)
     * @param {number} b - Blue component (0-255)
     * @returns {boolean} True if color is light (brightness > 128), false if dark
     */
    function isLightColor(r, g, b) {
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128;
    }

    /**
     * Quantizes colors using a median cut algorithm to extract dominant colors.
     * 
     * The median cut algorithm works by:
     * 1) Starting with all pixels in one bucket
     * 2) Finding the color channel (R, G, or B) with the greatest range
     * 3) Sorting pixels by that channel and splitting at the median
     * 4) Repeating until we have the desired number of color buckets
     * 5) Calculating the average color of each bucket as the dominant color
     * 
     * This approach efficiently groups similar colors together and finds
     * representative colors that capture the image's color palette.
     * 
     * @param {Array<Array<number>>} pixels - Array of pixel colors, each as [R, G, B]
     * @param {number} colorCount - Desired number of dominant colors to extract
     * @returns {Array<Array<number>>} Array of dominant colors, each as [R, G, B]
     */
    function quantizeColors(pixels, colorCount) {
        // Start with all pixels in a single bucket
        const buckets = [pixels];
        const finalColors = [];

        // Recursively split buckets until we have enough colors
        // Each split divides pixels along the color channel with the greatest variance
        while (buckets.length < colorCount && buckets.length > 0) {
            const bucket = buckets.shift();
            if (bucket.length === 0) continue;

            // Find the color channel (R, G, or B) with the greatest range
            // This channel has the most variation and is best for splitting
            let rMin = 255, rMax = 0;
            let gMin = 255, gMax = 0;
            let bMin = 255, bMax = 0;

            bucket.forEach(pixel => {
                const [r, g, b] = pixel;
                rMin = Math.min(rMin, r);
                rMax = Math.max(rMax, r);
                gMin = Math.min(gMin, g);
                gMax = Math.max(gMax, g);
                bMin = Math.min(bMin, b);
                bMax = Math.max(bMax, b);
            });

            const rRange = rMax - rMin;
            const gRange = gMax - gMin;
            const bRange = bMax - bMin;

            // Determine which channel has the greatest range for sorting
            let sortChannel = 0; // 0 = R, 1 = G, 2 = B
            if (gRange > rRange && gRange > bRange) {
                sortChannel = 1;
            } else if (bRange > rRange) {
                sortChannel = 2;
            }

            // Sort pixels by the channel with greatest range
            bucket.sort((a, b) => a[sortChannel] - b[sortChannel]);

            // Split at median to create two new buckets
            const median = Math.floor(bucket.length / 2);
            buckets.push(bucket.slice(0, median));
            buckets.push(bucket.slice(median));
        }

        // Calculate the average color for each bucket
        // This average represents the dominant color for that group of pixels
        buckets.forEach(bucket => {
            if (bucket.length === 0) return;

            let rSum = 0, gSum = 0, bSum = 0;
            bucket.forEach(pixel => {
                rSum += pixel[0];
                gSum += pixel[1];
                bSum += pixel[2];
            });

            finalColors.push([
                Math.round(rSum / bucket.length),
                Math.round(gSum / bucket.length),
                Math.round(bSum / bucket.length)
            ]);
        });

        // Fallback: If median cut didn't produce enough colors (e.g., image is very uniform),
        // fill remaining slots with random sampled pixels from the image
        if (finalColors.length < colorCount) {
            const allPixels = [];
            // Sample every 100th pixel for fallback color selection
            for (let i = 0; i < pixels.length; i += 100) {
                allPixels.push(pixels[i]);
            }
            
            // Add random pixels until we reach the desired color count
            const remaining = colorCount - finalColors.length;
            for (let i = 0; i < remaining && allPixels.length > 0; i++) {
                const randomIndex = Math.floor(Math.random() * allPixels.length);
                finalColors.push(allPixels[randomIndex]);
            }
        }

        return finalColors.slice(0, colorCount);
    }

    /**
     * Extracts dominant colors from an image using color quantization.
     * 
     * This is the main color extraction function that:
     * 1) Resizes the image to a manageable size for performance
     * 2) Samples pixels from the image (skipping transparent pixels)
     * 3) Uses median cut quantization to find dominant colors
     * 
     * The image is resized to a maximum of 200px on the longest side to balance
     * processing speed with color accuracy. For color extraction, this resolution
     * is sufficient as we're looking for overall color trends, not pixel-perfect detail.
     * 
     * @param {HTMLImageElement} image - The loaded image element
     * @param {number} colorCount - Number of dominant colors to extract (default: 5)
     * @returns {Promise<Array<Array<number>>>} Promise resolving to array of dominant colors as [R, G, B]
     */
    async function extractDominantColors(image, colorCount = 5) {
        return new Promise((resolve) => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            // Resize image for faster processing while maintaining aspect ratio
            // 200px is sufficient for color analysis and significantly faster than full resolution
            const maxSize = 200;
            let width = image.naturalWidth;
            let height = image.naturalHeight;
            
            // Calculate new dimensions maintaining aspect ratio
            if (width > height) {
                if (width > maxSize) {
                    height = (height / width) * maxSize;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width = (width / height) * maxSize;
                    height = maxSize;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            // Draw resized image to canvas
            ctx.drawImage(image, 0, 0, width, height);
            
            // Extract pixel data from canvas (RGBA format, 4 bytes per pixel)
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;
            const pixelArray = [];
            
            // Sample every 4th pixel (step by 16 bytes = 4 pixels * 4 bytes RGBA)
            // This reduces processing time while still capturing color distribution
            for (let i = 0; i < pixels.length; i += 16) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];
                
                // Skip transparent or semi-transparent pixels (alpha < 128)
                // Transparent pixels don't contribute meaningful color information
                if (a > 128) {
                    pixelArray.push([r, g, b]);
                }
            }
            
            // Use median cut algorithm to quantize colors and find dominants
            const dominantColors = quantizeColors(pixelArray, colorCount);
            resolve(dominantColors);
        });
    }

    /**
     * Event handler for image file upload.
     * 
     * When a user selects an image file:
     * 1) Validates the file is an image
     * 2) Reads the file as a data URL
     * 3) Loads the image into an Image element
     * 4) Extracts dominant colors and calculates percentages
     * 5) Updates the UI to display the color palette bar
     * 
     * This is the entry point for the color extraction workflow.
     */
    imageUpload.addEventListener("change", async (event) => {
        console.log("File selected");
        const file = event.target.files[0];
        // Validate file exists and is an image type
        if (!file || !file.type.startsWith("image/")) {
            console.log("Invalid file type");
            return;
        }

        // Show loading state while processing
        // This provides user feedback that the image is being analyzed
        colorBar.innerHTML = "<div style='padding: 16px; text-align: center;'>Processing image...</div>";

        // Use FileReader to convert the file to a data URL that can be used as an image source
        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            
            // Temporarily add image to DOM (hidden) so it can be processed
            // Some image processing operations require the image to be in the DOM
            img.style.display = "none";
            img.style.position = "absolute";
            img.style.visibility = "hidden";
            document.body.appendChild(img);
            
            // Wait for image to fully load before processing
            // This ensures naturalWidth and naturalHeight are available
            img.onload = async () => {
                try {
                    console.log("Image loaded, extracting colors...");
                    console.log("Image dimensions:", img.naturalWidth, "x", img.naturalHeight);
                    
                    // Extract 5 dominant colors using median cut quantization algorithm
                    const palette = await extractDominantColors(img, 5);
                    console.log("Palette extracted:", palette);
                    
                    if (!palette || palette.length === 0) {
                        throw new Error("Failed to extract palette");
                    }
                    
                    // Calculate what percentage of the image each dominant color represents
                    // This determines the width of each segment in the color bar
                    const percentages = await calculateColorPercentages(img, palette);
                    console.log("Percentages calculated:", percentages);
                    
                    // Clean up: remove temporary image from DOM
                    document.body.removeChild(img);
                    
                    // Clear any previous color bar content
                    colorBar.innerHTML = "";
                    
                    // Create and display color segments in the palette bar
                    // Each segment's width is proportional to that color's presence in the image
                    palette.forEach((color, index) => {
                        const [r, g, b] = color;
                        const percentage = percentages[index];
                        const hexColor = rgbToHex(r, g, b);
                        // Choose text color (black or white) based on background brightness for readability
                        const textColor = isLightColor(r, g, b) ? "#000000" : "#FFFFFF";
                        
                        // Create a div element for this color segment
                        const segment = document.createElement("div");
                        segment.className = "color-segment";
                        segment.style.backgroundColor = hexColor;
                        segment.style.color = textColor;
                        // Width is percentage-based to show relative color distribution
                        segment.style.width = `${percentage}%`;
                        // Minimum width ensures small percentages are still visible
                        segment.style.minWidth = percentage > 0 ? "40px" : "0";
                        segment.textContent = `${percentage.toFixed(1)}%`;
                        // Tooltip shows RGB values and hex code for accessibility
                        segment.title = `RGB(${r}, ${g}, ${b}) - ${hexColor}`;
                        
                        colorBar.appendChild(segment);
                    });
                } catch (error) {
                    console.error("Error extracting colors:", error);
                    // Clean up temporary image if still in DOM
                    if (img.parentNode) {
                        document.body.removeChild(img);
                    }
                    // Display error message to user
                    colorBar.innerHTML = `<div style='padding: 16px; color: red;'>Error: ${error.message}. Please try another image.</div>`;
                }
            };
            
            // Handle image loading errors (e.g., corrupted file, unsupported format)
            img.onerror = (error) => {
                console.error("Image load error:", error);
                if (img.parentNode) {
                    document.body.removeChild(img);
                }
                colorBar.innerHTML = "<div style='padding: 16px; color: red;'>Failed to load image. Please try another image.</div>";
            };
            
            // Set image source to trigger loading
            img.src = e.target.result;
        };
        
        // Handle file reading errors
        reader.onerror = (error) => {
            console.error("FileReader error:", error);
            colorBar.innerHTML = "<div style='padding: 16px; color: red;'>Failed to read file. Please try another image.</div>";
        };
        
        // Start reading the file as a data URL
        reader.readAsDataURL(file);
    });

    /**
     * Event handler for the "Import img to page" button click.
     * 
     * This function uses the Adobe Express Add-on SDK to import the uploaded image
     * directly onto the Express editor canvas. The image is added to the current
     * document at the insertion point.
     * 
     * The addImage API is part of the Express document API and handles:
     * - Converting the blob to an image element on the canvas
     * - Positioning it appropriately in the document
     * - Making it available for editing in Express
     */
    importButton.addEventListener("click", async () => {
        try {
            // Validate that a file has been selected before attempting import
            if (!imageUpload.files || imageUpload.files.length === 0) {
                alert("Please select an image file first.");
                return;
            }

            const file = imageUpload.files[0];
            
            // Double-check file type for security
            if (!file.type.startsWith("image/")) {
                alert("Please select a valid image file.");
                return;
            }

            // Convert File object to Blob for the Express SDK API
            // The addImage API expects a Blob with the correct MIME type
            const blob = new Blob([file], { type: file.type });
            
            // Use Adobe Express SDK to add the image to the document canvas
            // This is an async operation that communicates with the Express editor
            // The image will appear on the canvas at the current insertion point
            await addOnUISdk.app.document.addImage(blob);
            
            console.log("Image successfully imported to the document.");
        } catch (error) {
            console.error("Error importing image:", error);
            // Display error to user if import fails (e.g., SDK error, permission issue)
            alert(`Failed to import image: ${error.message || "Unknown error"}`);
        }
    });
});
