const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { google } = require("googleapis");
// const fs = require("fs").promises;
// const path = require("path");
// const mime = require('mime-types');

const moveFolder = async ({ drive, folderId, newParentId }) => {
  try {
    // Get current information of the directory
    const folderMetadata = await drive.files.get({
      fileId: folderId,
      fields: "parents",
    });

    // Get the list of current parents of the directory
    const currentParents = folderMetadata.data.parents.join(",");

    // Move folder into new folder by deleting old parent and adding new parent
    await drive.files.update({
      fileId: folderId,
      addParents: newParentId,
      removeParents: currentParents,
      fields: "id, parents",
    });

    console.log(`Folder ${folderId} has been moved to ${newParentId}.`);
  } catch (error) {
    throw Error(`Error moving folder: ${error}`);
  }
};

const deleteFolder = async ({ drive, folderId }) => {
  try {
    await drive.files.delete({
      fileId: folderId,
    });

    console.log(`Folder with ID ${folderId} has been deleted.`);
  } catch (error) {
    console.error("Error deleting folder:", error);
  }
};

exports.handler = async (event, context) => {
  const sig = event.headers["stripe-signature"];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log("Stripe event constructed successfully");
  } catch (err) {
    console.error("Error constructing Stripe event:", err);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`,
    };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    console.log("Checkout session completed event received");
    const session = stripeEvent.data.object;

    // Initialize Google Drive API client
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(
        process.env.GOOGLE_APPLICATION_CREDENTIALS.replace(/'/g, '"')
      ),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    const drive = google.drive({ version: "v3", auth });
    console.log("Google Drive API client initialized");

    if (session.payment_status === "paid") {
      console.log("Payment status: paid");
      const businessSpecific = session.metadata.businessSpecific;
      const cost = session.amount_total / 100; // Convert from cents to dollars
      const turnaroundTime = session.metadata.turnaroundTime;
      const fileId = session.metadata.fileId;

      try {
        const folderId = "1jZgmesu0ixGYkOqF2iFsoEhFa30cEPQx"; // Change to google drive folder id containing official files (After the user has successfully paid)

        await moveFolder({
          drive,
          folderId: fileId,
          newParentId: folderId,
        });

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
          parents: [fileId],
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

        return {
          statusCode: 200,
          body: "Payment successfully processed and files uploaded to Google Drive",
        };
      } catch (error) {
        console.error("Error uploading files to Google Drive:", error);
        return {
          statusCode: 500,
          body: "Payment processed, but an error occurred while uploading files to Google Drive",
        };
      }
    } else {
      console.log("Payment not completed");
      const fileId = session.metadata.fileId;
      // Delete the temporarily stored files
      await deleteFolder({
        drive,
        folderId: fileId,
      });
      return {
        statusCode: 200,
        body: "Payment not completed",
      };
    }
  }

  console.log("Unhandled event type:", stripeEvent.type);
  return {
    statusCode: 400,
    body: `Unhandled event type: ${stripeEvent.type}`,
  };
};
