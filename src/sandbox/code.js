/**
 * Document Sandbox runtime for the Color Extractor Adobe Express Add-on.
 * 
 * The sandbox runs in a separate security context from the UI and has direct
 * access to the Adobe Express document SDK. This allows safe manipulation of
 * the document without exposing sensitive APIs to the UI layer.
 * 
 * Note: This file contains example code for creating rectangles. In the current
 * implementation, the add-on uses the UI SDK's addImage API directly, so this
 * sandbox code is not actively used. However, it demonstrates how to expose
 * custom document manipulation APIs from the sandbox to the UI.
 */
import addOnSandboxSdk from "add-on-sdk-document-sandbox";
import { editor } from "express-document-sdk";

// Get the document sandbox runtime instance
// This provides the API to expose functions to the UI runtime
const { runtime } = addOnSandboxSdk.instance;

/**
 * Initializes the sandbox and exposes APIs to the UI runtime.
 * 
 * The sandbox API allows the UI (index.html) to call functions that manipulate
 * the Express document. These functions run in the sandbox context which has
 * direct access to the document SDK.
 */
function start() {
    // Define APIs to be exposed to the UI runtime
    // These functions can be called from ui/index.js via the sandboxProxy
    const sandboxApi = {
        /**
         * Example function: Creates a colored rectangle on the Express canvas.
         * 
         * This demonstrates how to use the Express document SDK to create and
         * manipulate document elements. The rectangle is added at the current
         * insertion point in the document.
         * 
         * Note: This function is not currently used by the add-on, but serves
         * as a template for future document manipulation features.
         */
        createRectangle: () => {
            // Create a rectangle shape using the Express document editor
            const rectangle = editor.createRectangle();

            // Set rectangle dimensions in pixels
            rectangle.width = 240;
            rectangle.height = 180;

            // Set rectangle position relative to the insertion point
            // Translation offsets the element from its default position
            rectangle.translation = { x: 10, y: 10 };

            // Define color in normalized RGBA format (0.0 to 1.0)
            // This example creates a purple/blue color
            const color = { red: 0.32, green: 0.34, blue: 0.89, alpha: 1 };

            // Create a color fill object and apply it to the rectangle
            // The fill determines the interior color of the shape
            const rectangleFill = editor.makeColorFill(color);
            rectangle.fill = rectangleFill;

            // Get the current insertion parent (the container where new elements are added)
            // This is typically the active artboard or page in the Express document
            const insertionParent = editor.context.insertionParent;
            // Add the rectangle to the document's element tree
            insertionParent.children.append(rectangle);
        }
    };

    // Expose the sandbox API to the UI runtime
    // This makes the functions available via runtime.apiProxy("documentSandbox")
    // in the UI code (ui/index.js)
    runtime.exposeApi(sandboxApi);
}

// Initialize the sandbox when this module loads
start();
