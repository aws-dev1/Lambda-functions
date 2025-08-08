const { DynamoDBClient, ScanCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamo = new DynamoDBClient({});
const TABLE = "Events";

exports.handler = async (event) => {
  console.log("Incoming event:", JSON.stringify(event));

  try {
    let result;
    const eventId = event?.queryStringParameters?.eventId;

    if (eventId) {
      console.log("Fetching single event:", eventId);
      const { Item } = await dynamo.send(new GetItemCommand({
        TableName: TABLE,
        Key: { eventId: { S: eventId } }
      }));

      if (!Item) {
        return response(404, { error: "Event not found" });
      }

      result = unmarshall(Item);
    } else {
      console.log("Fetching all events...");
      const data = await dynamo.send(new ScanCommand({
        TableName: TABLE
      }));

      result = data.Items.map(item => unmarshall(item));
    }

    return response(200, result);

  } catch (err) {
    console.error("Error in getEvents:", err);
    return response(500, { error: err.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}
