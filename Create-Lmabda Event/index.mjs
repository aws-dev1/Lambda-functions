import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});
const BUCKET = "event-assets-store"; // ✅ Replace with your actual bucket name
const TABLE = "Events"; // ✅ Replace if your DynamoDB table name is different

export const handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  try {
    // ✅ Robust body parsing for both API Gateway and Lambda console
    let rawBody = event.body;
    if (!rawBody && event.title) {
      rawBody = JSON.stringify(event);
    }
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    const eventId = uuidv4();
    const createdAt = Date.now();

    console.log("Parsed body. Generating event:", eventId);

    // ✅ Upload banner
    const bannerUrl = await uploadImage(body.bannerBase64, `banners/${eventId}.jpg`);
    console.log("Banner uploaded:", bannerUrl);

    // ✅ Upload speaker photos
    const speakers = await Promise.all((body.speakers || []).map(async (s, i) => {
      const photo = await uploadImage(s.photoBase64, `speakers/${eventId}_${i}.jpg`);
      return {
        M: {
          name: { S: s.name },
          designation: { S: s.designation },
          photo: { S: photo }
        }
      };
    }));

    // ✅ Upload partner logos
    const partners = await Promise.all((body.partners || []).map(async (p, i) => {
      const logo = await uploadImage(p.logoBase64, `partners/${eventId}_${i}.jpg`);
      return {
        M: {
          name: { S: p.name },
          logo: { S: logo }
        }
      };
    }));

    // ✅ Prepare DynamoDB item
    const item = {
      eventId: { S: eventId },
      createdAt: { N: createdAt.toString() },
      title: { S: body.title },
      date: { S: body.date },
      template: { S: body.template },
      description: { S: body.description },
      bannerUrl: { S: bannerUrl },
      speakers: { L: speakers },
      agenda: {
        L: (body.agenda || []).map(a => ({
          M: {
            title: { S: a.title },
            time: { S: a.time }
          }
        }))
      },
      partners: { L: partners },
      videos: {
        L: (body.videos || []).map(link => ({ S: link }))
      },
      contact: {
        M: {
          organizer: { S: body.contact.organizer },
          email: { S: body.contact.email },
          whatsapp: { S: body.contact.whatsapp },
          message: { S: body.contact.message }
        }
      }
    };

    await dynamo.send(new PutItemCommand({
      TableName: TABLE,
      Item: item
    }));

    console.log("Event stored in DynamoDB:", eventId);

    return {
      statusCode: 201,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: JSON.stringify({ message: "Event created", eventId })
    };

  } catch (err) {
    console.error("Error while creating event:", {
      message: err.message,
      stack: err.stack
    });

    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: JSON.stringify({ error: "Failed to create event", detail: err.message })
    };
  }
};

// ✅ Upload image to S3 (without ACL)
async function uploadImage(base64Data, key) {
  const base64Body = base64Data.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Body, "base64");
  const type = base64Data.includes("png") ? "image/png" : "image/jpeg";

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: type
  });

  await s3.send(cmd);
  return `https://${BUCKET}.s3.amazonaws.com/${key}`;
}
