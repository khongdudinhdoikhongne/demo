const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const serverless = require("serverless-http");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { processFile } = require("./upload"); // Import the processFile function from upload.js
const { google } = require("googleapis");
// const fs = require("fs").promises; // Add this line to require the 'fs' module
// const path = require("path"); // Add this line to require the 'path' module
const { Readable } = require("stream"); // Create stream from buffer to upload files to google drive
const axios = require("axios");

const app = express();
app.use(express.json());

const allowedOrigins = [
  "http://localhost:8888",
  "https://lucky-liger-cadc9d.netlify.app",
  "https://eduardos-stupendous-site-4488f5.webflow.io",
  "https://www.typewriters.ai",
  "https://jovial-treacle-09f7aa.netlify.app",
];

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

const storage = multer.memoryStorage();
const upload = multer({ storage });

// Function create temporarily folder in google drive
const driveFolderCreate = async ({
  drive,
  parentsFolderId = "1-qp-RFiTBWT80Fv0WUXPD6jcYPivt6Ym" /* Replace it with google drive folder id containing temporary */,
}) => {
  try {
    // Create a folder in Google Drive to store the uploaded files
    const folderName = `Order_${Date.now()}`; // Use a unique folder name based on the current timestamp
    const folderMetadata = {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentsFolderId],
    };
    const folder = await drive.files.create({
      resource: folderMetadata,
      fields: "id, webViewLink",
    });
    const folderId = folder.data.id;
    const folderLink = folder.data.webViewLink;
    console.log(
      "Temporarily folder created in Google Drive with ID:",
      folderId
    );
    console.log("Temporarily folder link:", folderLink);
    return folderId;
  } catch (error) {
    console.log("Unable to create temporary folder in Google drive:", error);
    return null;
  }
};

// Function upload file to temporarily folder in google drive
const driveUpload = async ({
  drive,
  driveFolderId,
  fileName,
  fileMineType,
  buffer,
}) => {
  try {
    const fileMetadata = {
      name: fileName,
      parents: [driveFolderId], // Use the ID of the created folder
    };

    // Create a Readable stream from the buffer
    const readableStream = new Readable();
    readableStream.push(buffer);
    readableStream.push(null); // Indicates the end of the stream

    const media = {
      mimeType: fileMineType,
      body: readableStream,
    };
    await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: "id",
    });
    console.log("Temporarily file uploaded to Google Drive:", fileName);
  } catch (error) {
    console.error("Error uploading temporarily files to Google Drive:", error);
  }
};

app.post(
  "/.netlify/functions/create-stripe-payment",
  upload.fields([{ name: "file" }, { name: "contextFile" }]),
  async (req, res) => {
    try {
      console.log("Starting create-stripe-payment function");

      const file = req.files["file"][0];
      const contextFile = req.files["contextFile"]
        ? req.files["contextFile"][0]
        : null;
      const turnaroundTime = req.body.turnaroundTime;
      const quality = req.body.quality;

      // Get the reCAPTCHA token from the request body
      const recaptchaToken = req.body["g-recaptcha-response"];

      // Verify the reCAPTCHA token
      const recaptchaSecret = process.env.RECAPTCHA_SECRET_KEY;
      const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${recaptchaSecret}&response=${recaptchaToken}`;

      const recaptchaVerificationResponse = await axios.post(verificationUrl);
      const recaptchaVerificationData = recaptchaVerificationResponse.data;

      console.log("reCAPTCHA score:", recaptchaVerificationData.score);

      if (
        !recaptchaVerificationData.success ||
        recaptchaVerificationData.score < 0.5
      ) {
        console.error("reCAPTCHA verification failed");
        return res.status(400).json({ error: "reCAPTCHA verification failed" });
      }

      if (!file) {
        res.status(400).json({ error: "No file uploaded." });
        return;
      }

      console.log("File received, processing file...");

      const price = await processFile(file, turnaroundTime, quality);
      const priceInCents = Math.round(price * 100);

      console.log("File processed, creating Stripe price object...");

      // Create the priceObject
      const priceObject = await stripe.prices.create({
        unit_amount: priceInCents,
        currency: "usd",
        product_data: {
          name: "Fixed Payment",
        },
      });

      console.log("Stripe price object created, generating file ID...");

      // Generate a unique identifier for the files
      // const fileId = Date.now().toString();

      console.log("File ID generated, storing files temporarily...");

      // Store the files temporarily on the server
      const tempFiles = [file, contextFile].filter(Boolean);

      // Initialize Google Drive API client
      const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(
          process.env.GOOGLE_APPLICATION_CREDENTIALS.replace(/'/g, '"')
        ),
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      const drive = google.drive({ version: "v3", auth });
      console.log("Google Drive API client initialized");

      // Create a folder containing new temporary files for ordering in google drive
      const driveFolderId = await driveFolderCreate({
        drive,
      });
      // If unable to create a folder containing temporary files in Google Drive, return an error
      if (driveFolderId === null) {
        throw Error("Unable to create temporary folder in Google drive");
      }

      await Promise.all(
        tempFiles.map(async (tempFile, index) => {
          // Add files uploaded by users to temporary folder in google drive
          const tempFileName = tempFile.originalname;
          const tempFileMineType = tempFile.mimetype;
          // const tempFilePath = path.join("/tmp", tempFileName);
          // return fs.writeFile(tempFilePath, tempFile.buffer);

          // Now click on the "Pay with Stripe" button on the website,
          // the code will upload the file to the temporary folder in Google drive
          // In some cases if the file is large in size, loading can take a long time,
          // which can mislead the user into thinking that the code is not running.
          // Uploading files to google's temporary directory can be done asynchronously by changing "await driveUpload" to "driveUpload",
          // This allows the payment link generation to occur simultaneously while uploading the file.
          await driveUpload({
            drive,
            driveFolderId,
            fileName: tempFileName,
            fileMineType: tempFileMineType,
            buffer: tempFile.buffer,
          });
        })
      );

      console.log("Files stored temporarily, creating Stripe payment link...");

      const paymentLink = await stripe.paymentLinks.create({
        line_items: [
          {
            price: priceObject.id,
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        payment_intent_data: {
          capture_method: "automatic",
        },
        metadata: {
          fileId: driveFolderId, // Replace fileId to driveFolderId (google drive folder id) containing temporary files, used for processing when users make payments
          businessSpecific: quality === "Business specific",
          turnaroundTime: turnaroundTime,
        },
      });

      console.log("Stripe payment link created:", paymentLink);

      res.json({ paymentLink: paymentLink.url });
    } catch (error) {
      console.error("Error generating Stripe payment link:", error);
      res.status(500).json({ error: "Failed to generate Stripe payment link" });
    }
  }
);

app.post("/.netlify/functions/stripe-webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("Stripe event constructed successfully");
  } catch (err) {
    console.error("Error constructing Stripe event:", err);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (stripeEvent.type === "checkout.session.completed") {
    console.log("Checkout session completed event received");
    const session = stripeEvent.data.object;

    if (session.payment_status === "paid") {
      console.log("Payment status: paid");
      // Retrieve the files and details from the session metadata
      const files = JSON.parse(session.metadata.files);
      const businessSpecific = session.metadata.businessSpecific;
      const cost = session.amount_total / 100; // Convert from cents to dollars
      const turnaroundTime = session.metadata.turnaroundTime;

      try {
        // Initialize Google Drive API client
        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(
            process.env.GOOGLE_APPLICATION_CREDENTIALS.replace(/'/g, '"')
          ),
          scopes: ["https://www.googleapis.com/auth/drive"],
        });
        const drive = google.drive({ version: "v3", auth });
        console.log("Google Drive API client initialized");

        // Create a folder in Google Drive to store the uploaded files
        const folderName = `Order_${Date.now()}`; // Use a unique folder name based on the current timestamp
        const folderMetadata = {
          name: folderName,
          mimeType: "application/vnd.google-apps.folder",
          parents: ["1jOZcw-_tr71AuFq55YckTWeYg5VpjEYy"], // Add the parent folder ID here
        };
        const folder = await drive.files.create({
          resource: folderMetadata,
          fields: "id",
        });
        const folderId = folder.data.id;
        console.log("Folder created in Google Drive with ID:", folderId);

        // Upload each file to the created folder in Google Drive
        for (const file of files) {
          if (file !== null) {
            const fileMetadata = {
              name: file.originalname,
              parents: [folderId],
            };
            const media = {
              mimeType: file.mimetype,
              body: Buffer.from(file.buffer, "base64"),
            };
            await drive.files.create({
              resource: fileMetadata,
              media: media,
              fields: "id",
            });
            console.log("File uploaded to Google Drive:", file.originalname);
          }
        }

        // Store the additional details in a file in Google Drive
        const orderDetails = {
          businessSpecific,
          cost,
          turnaroundTime,
          timestamp: new Date().toISOString(),
        };
        const orderDetailsFileName = "order_details.json";
        const orderDetailsFileMetadata = {
          name: orderDetailsFileName,
          parents: [folderId],
          mimeType: "application/json",
        };
        const orderDetailsFileMedia = {
          mimeType: "application/json",
          body: JSON.stringify(orderDetails),
        };
        await drive.files.create({
          resource: orderDetailsFileMetadata,
          media: orderDetailsFileMedia,
          fields: "id",
        });
        console.log("Order details stored in Google Drive");

        return res.status(200).json({
          message:
            "Payment successfully processed and files uploaded to Google Drive",
        });
      } catch (error) {
        console.error("Error uploading files to Google Drive:", error);
        return res.status(500).json({
          error:
            "Payment processed, but an error occurred while uploading files to Google Drive",
        });
      }
    } else {
      console.log("Payment not completed");
      return res.status(200).json({ message: "Payment not completed" });
    }
  }

  console.log("Unhandled event type:", stripeEvent.type);
  return res
    .status(400)
    .json({ error: `Unhandled event type: ${stripeEvent.type}` });
});

module.exports.handler = serverless(app);
