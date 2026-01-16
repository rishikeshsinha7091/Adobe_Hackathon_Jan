import addOnUISdk from "https://new.express.adobe.com/static/add-on-sdk/sdk.js";

addOnUISdk.ready.then(async () => {
    console.log("addOnUISdk is ready for use.");

    // Get the UI runtime.
    const { runtime } = addOnUISdk.instance;

    // Get the proxy object, which is required
    // to call the APIs defined in the Document Sandbox runtime
    // i.e., in the `code.js` file of this add-on.
    const sandboxProxy = await runtime.apiProxy("documentSandbox");

    const imageUpload = document.getElementById("imageUpload");
    const colorBar = document.getElementById("colorBar");
    const importButton = document.getElementById("importButton");
    
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

    // Helper function to calculate color distance
    function colorDistance(rgb1, rgb2) {
        const [r1, g1, b1] = rgb1;
        const [r2, g2, b2] = rgb2;
        return Math.sqrt(
            Math.pow(r2 - r1, 2) + Math.pow(g2 - g1, 2) + Math.pow(b2 - b1, 2)
        );
    }

    // Helper function to find closest dominant color for a pixel
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

    // Function to calculate color percentages from pixel data
    async function calculateColorPercentages(image, dominantColors) {
        return new Promise((resolve) => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            ctx.drawImage(image, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            const colorCounts = new Array(dominantColors.length).fill(0);
            const totalPixels = canvas.width * canvas.height;
            
            // Sample pixels (every 10th pixel for performance)
            const sampleRate = 10;
            let sampledPixels = 0;
            
            for (let i = 0; i < pixels.length; i += 4 * sampleRate) {
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const pixelRgb = [r, g, b];
                
                const closestIndex = findClosestColor(pixelRgb, dominantColors);
                colorCounts[closestIndex]++;
                sampledPixels++;
            }
            
            // Calculate percentages
            const percentages = colorCounts.map(count => 
                (count / sampledPixels) * 100
            );
            
            resolve(percentages);
        });
    }

    // Function to convert RGB to hex
    function rgbToHex(r, g, b) {
        return "#" + [r, g, b].map(x => {
            const hex = x.toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }

    // Function to determine if color is light or dark (for text contrast)
    function isLightColor(r, g, b) {
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        return brightness > 128;
    }

    // Simple color quantization using median cut algorithm
    function quantizeColors(pixels, colorCount) {
        // Create color buckets
        const buckets = [pixels];
        const finalColors = [];

        // Split buckets until we have enough colors
        while (buckets.length < colorCount && buckets.length > 0) {
            const bucket = buckets.shift();
            if (bucket.length === 0) continue;

            // Find the color channel with the greatest range
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

            // Sort by the channel with the greatest range
            let sortChannel = 0; // 0 = R, 1 = G, 2 = B
            if (gRange > rRange && gRange > bRange) {
                sortChannel = 1;
            } else if (bRange > rRange) {
                sortChannel = 2;
            }

            bucket.sort((a, b) => a[sortChannel] - b[sortChannel]);

            // Split at median
            const median = Math.floor(bucket.length / 2);
            buckets.push(bucket.slice(0, median));
            buckets.push(bucket.slice(median));
        }

        // Calculate average color for each bucket
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

        // If we don't have enough colors, fill with additional colors from the image
        if (finalColors.length < colorCount) {
            const allPixels = [];
            for (let i = 0; i < pixels.length; i += 100) { // Sample every 100th pixel
                allPixels.push(pixels[i]);
            }
            
            // Use k-means clustering for remaining colors
            const remaining = colorCount - finalColors.length;
            for (let i = 0; i < remaining && allPixels.length > 0; i++) {
                const randomIndex = Math.floor(Math.random() * allPixels.length);
                finalColors.push(allPixels[randomIndex]);
            }
        }

        return finalColors.slice(0, colorCount);
    }

    // Extract dominant colors from image using canvas
    async function extractDominantColors(image, colorCount = 5) {
        return new Promise((resolve) => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            // Resize image for faster processing (max 200px on longest side)
            const maxSize = 200;
            let width = image.naturalWidth;
            let height = image.naturalHeight;
            
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
            ctx.drawImage(image, 0, 0, width, height);
            
            const imageData = ctx.getImageData(0, 0, width, height);
            const pixels = imageData.data;
            const pixelArray = [];
            
            // Extract pixel colors (sample every 4th pixel for performance)
            for (let i = 0; i < pixels.length; i += 16) { // Every 4th pixel (RGBA = 4 bytes)
                const r = pixels[i];
                const g = pixels[i + 1];
                const b = pixels[i + 2];
                const a = pixels[i + 3];
                
                // Skip transparent pixels
                if (a > 128) {
                    pixelArray.push([r, g, b]);
                }
            }
            
            // Quantize colors
            const dominantColors = quantizeColors(pixelArray, colorCount);
            resolve(dominantColors);
        });
    }

    // Handle file upload
    imageUpload.addEventListener("change", async (event) => {
        console.log("File selected");
        const file = event.target.files[0];
        if (!file || !file.type.startsWith("image/")) {
            console.log("Invalid file type");
            return;
        }

        // Show loading state
        colorBar.innerHTML = "<div style='padding: 16px; text-align: center;'>Processing image...</div>";

        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            
            // ColorThief needs the image to be in the DOM or have crossOrigin set
            // We'll add it temporarily and hide it
            img.style.display = "none";
            img.style.position = "absolute";
            img.style.visibility = "hidden";
            document.body.appendChild(img);
            
            img.onload = async () => {
                try {
                    console.log("Image loaded, extracting colors...");
                    console.log("Image dimensions:", img.naturalWidth, "x", img.naturalHeight);
                    
                    // Extract dominant colors using our custom algorithm
                    const palette = await extractDominantColors(img, 5);
                    console.log("Palette extracted:", palette);
                    
                    if (!palette || palette.length === 0) {
                        throw new Error("Failed to extract palette");
                    }
                    
                    // Calculate color percentages
                    const percentages = await calculateColorPercentages(img, palette);
                    console.log("Percentages calculated:", percentages);
                    
                    // Remove temporary image from DOM
                    document.body.removeChild(img);
                    
                    // Clear previous color bar
                    colorBar.innerHTML = "";
                    
                    // Display colors in the color bar
                    palette.forEach((color, index) => {
                        const [r, g, b] = color;
                        const percentage = percentages[index];
                        const hexColor = rgbToHex(r, g, b);
                        const textColor = isLightColor(r, g, b) ? "#000000" : "#FFFFFF";
                        
                        const segment = document.createElement("div");
                        segment.className = "color-segment";
                        segment.style.backgroundColor = hexColor;
                        segment.style.color = textColor;
                        segment.style.width = `${percentage}%`;
                        segment.style.minWidth = percentage > 0 ? "40px" : "0";
                        segment.textContent = `${percentage.toFixed(1)}%`;
                        segment.title = `RGB(${r}, ${g}, ${b}) - ${hexColor}`;
                        
                        colorBar.appendChild(segment);
                    });
                } catch (error) {
                    console.error("Error extracting colors:", error);
                    // Remove temporary image if still in DOM
                    if (img.parentNode) {
                        document.body.removeChild(img);
                    }
                    colorBar.innerHTML = `<div style='padding: 16px; color: red;'>Error: ${error.message}. Please try another image.</div>`;
                }
            };
            
            img.onerror = (error) => {
                console.error("Image load error:", error);
                if (img.parentNode) {
                    document.body.removeChild(img);
                }
                colorBar.innerHTML = "<div style='padding: 16px; color: red;'>Failed to load image. Please try another image.</div>";
            };
            
            img.src = e.target.result;
        };
        
        reader.onerror = (error) => {
            console.error("FileReader error:", error);
            colorBar.innerHTML = "<div style='padding: 16px; color: red;'>Failed to read file. Please try another image.</div>";
        };
        
        reader.readAsDataURL(file);
    });

    // Handle import button click
    importButton.addEventListener("click", async () => {
        try {
            // Check if a file was selected
            if (!imageUpload.files || imageUpload.files.length === 0) {
                alert("Please select an image file first.");
                return;
            }

            const file = imageUpload.files[0];
            
            // Validate file type
            if (!file.type.startsWith("image/")) {
                alert("Please select a valid image file.");
                return;
            }

            // Convert file to Blob
            const blob = new Blob([file], { type: file.type });
            
            // Add image to the document using Adobe Express SDK
            await addOnUISdk.app.document.addImage(blob);
            
            console.log("Image successfully imported to the document.");
        } catch (error) {
            console.error("Error importing image:", error);
            alert(`Failed to import image: ${error.message || "Unknown error"}`);
        }
    });
});
