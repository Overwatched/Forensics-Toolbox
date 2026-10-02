document.addEventListener("DOMContentLoaded", () => {
    const dropArea = document.getElementById("drop-area");
    const dropAreaText = document.getElementById("drop-area-text");
    const fileInput = document.getElementById("file-input");
    const qrcodeResultDiv = document.getElementById("qrcode-result");
    const previewImage = document.getElementById("preview-image");
    const copyButton = document.getElementById("copy-button");
    const toast = document.getElementById("toast");

    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ["dragenter", "dragover"].forEach((eventName) => {
        document.body.addEventListener(eventName, highlight, false);
    });

    ["dragleave", "drop"].forEach((eventName) => {
        document.body.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropArea.classList.add("highlight");
    }

    function unhighlight(e) {
        dropArea.classList.remove("highlight");
    }

    // Handle dropped files — now on the whole document
    document.body.addEventListener("drop", handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        handleFiles(files);
    }

    // Click to open file dialog — stays scoped to drop-area only
    dropArea.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", () => {
        handleFiles(fileInput.files);
    });

    // Handle paste event
    document.addEventListener("paste", handlePaste);

    function handlePaste(event) {
        const items = (event.clipboardData || event.clipboard).items;
        let imageFile = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf("image") === 0) {
                imageFile = items[i].getAsFile();
                break; // Take the first image if multiple
            }
        }
        if (imageFile) {
            handleFiles([imageFile]); // Handle pasted image as a file
        }
    }

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            // Alla bildtyper släpps igenom; klarar inte webbläsaren formatet fångas det
            // av img.onerror nedan. Tidigare avvisades BMP och GIF i onödan.
            if (file.type.startsWith("image/")) {
                decodeImage(file);
            } else {
                displayResult("Ladda upp eller klistra in en bildfil.", true);
            }
        }
    }

    function decodeImage(imageFile) {
        displayResult("Avkodar QR-kod…", false, true);

        const reader = new FileReader();

        reader.onload = function (event) {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const context = canvas.getContext("2d");
                context.drawImage(img, 0, 0);
                const imageData = context.getImageData(
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // Show the image as a preview in the drop area
                previewImage.src = event.target.result;
                previewImage.style.display = "block";
                dropAreaText.style.display = "none";

                decodeQrCodeFromImageData(imageData, canvas.width, canvas.height)
                    .then((decodedText) => {
                        displayResult(decodedText || "Ingen QR-kod hittades.", !decodedText);
                    })
                    .catch((error) => {
                        displayResult("Kunde inte avkoda QR-koden.", true);
                        console.error("QR Code decoding error:", error);
                    });
            };
            img.onerror = function () {
                displayResult("Kunde inte läsa in bilden — formatet stöds kanske inte.", true);
            };
            img.src = event.target.result;
        };

        reader.onerror = function () {
            displayResult("Kunde inte läsa filen.", true);
        };

        reader.readAsDataURL(imageFile);
    }

    function decodeQrCodeFromImageData(imageData, width, height) {
        return new Promise((resolve, reject) => {
            try {
                const code = jsQR(imageData.data, width, height);
                if (code) {
                    resolve(code.data);
                } else {
                    resolve(null); // No QR code found
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    // Den avkodade nyttolasten hålls separat. Kopiering läste tidigare hela rutans
    // innerText, vilket innebar att status- och felmeddelanden kunde kopieras i stället.
    let decodedPayload = null;

    function displayResult(text, isError, isPending) {
        qrcodeResultDiv.innerHTML = ""; // Clear previous result
        const p = document.createElement("p");
        p.textContent = text;
        if (isError) {
            p.classList.add("error");
        }
        qrcodeResultDiv.appendChild(p);
        decodedPayload = (isError || isPending) ? null : text;
        copyButton.disabled = !decodedPayload;
    }

    copyButton.disabled = true;

    function copyPayload(onSuccess) {
        if (!decodedPayload) {
            showToast("Inget avkodat att kopiera");
            return;
        }
        navigator.clipboard
            .writeText(decodedPayload)
            .then(() => {
                if (onSuccess) onSuccess();
                showToast("Kopierat till urklipp");
            })
            .catch((err) => {
                console.error("Failed to copy text: ", err);
                showToast("Kunde inte kopiera");
            });
    }

    copyButton.addEventListener("click", () => copyPayload());

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add("show");
        setTimeout(() => {
            toast.classList.remove("show");
        }, 3000);
    }

    qrcodeResultDiv.addEventListener("dblclick", () => {
        if (!decodedPayload) return;
        copyPayload(flashGreen);
    });

    function flashGreen() {
        qrcodeResultDiv.classList.add("copied");

        setTimeout(() => {
            qrcodeResultDiv.classList.remove("copied");
        }, 800);
    }
});