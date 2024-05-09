const { google } = require("googleapis");
const multipart = require("parse-multipart");

exports.handler = async (event, context) => {
    try {
        // Initialize Google Drive API client
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS.replace(/'/g, '"')),
            scopes: ["https://www.googleapis.com/auth/drive"],
        });

        const drive = google.drive({ version: "v3", auth });

        console.log("Google Drive API client initialized");

        // Create a folder in Google Drive to store the uploaded files
        const folderName = `Order_${Date.now()}`; // Use a unique folder name based on the current timestamp
        const folderMetadata = {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: ["1jOZcw-_tr71AuFq55YckTWeYg5VpjEYy"],
        };

        const folderResponse = await drive.files.create({
            resource: folderMetadata,
            fields: "id",
        });

        const folderId = folderResponse.data.id;
        console.log(`Created folder with ID: ${folderId}`);

        // Parse the multipart form data
        const boundary = event.headers["content-type"].split("=")[1];
        const parts = multipart.Parse(Buffer.from(event.body, "base64"), boundary);

        const uploadFile = async (part) => {
            const fileMetadata = {
                name: part.filename,
                parents: [folderId],
            };

            const media = {
                mimeType: part.type,
                body: part.data,
            };

            console.log(`Uploading file: ${part.filename}`);
            console.log(`File metadata:`, fileMetadata);
            console.log(`File media:`, media);

            try {
                const fileResponse = await drive.files.create({
                    resource: fileMetadata,
                    media: media,
                    fields: "id",
                });

                console.log(`File uploaded successfully. File ID: ${fileResponse.data.id}`);
            } catch (error) {
                console.error(`Error uploading file ${part.filename}:`, error);
            }
        };

        // Upload files to the created folder
        for (const part of parts) {
            if (part.filename) {
                await uploadFile(part);
            }
        }


        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Files uploaded successfully" }),
        };
    } catch (error) {
        console.error("Error uploading files:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "An error occurred while uploading the files" }),
        };
    }
};
