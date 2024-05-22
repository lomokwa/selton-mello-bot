import fs from 'fs';
import { promisify } from 'util';

const remainingTimeFilePath = 'D:\\dev\\projects\\selton-mello-bot\\remainingTime.json';
const statusMessageIdFilePath = 'D:\\dev\\projects\\selton-mello-bot\\statusMessageId.json';
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

export async function getRemainingTime() {
  try {
    const data = await readFile(remainingTimeFilePath, 'utf8');
    const remainingTime = JSON.parse(data);
    return remainingTime;   
  } catch (err) {
    console.error(err);
    return { estimatedTimeToFinish: 'N/A', progress: 'N/A', elapsedTime: 'N/A'}
  }
}

async function getStatusMessageId() {
  try {
    const data = await readFile(statusMessageIdFilePath, 'utf8');
    return JSON.parse(data).statusMessageId;
  } catch (error) {
    console.error(`Failed to read status message ID: ${error}`);
    return null;
  }
}

async function saveStatusMessageId(messageId) {
  const data = { statusMessageId: messageId };
  await writeFile(statusMessageIdFilePath, JSON.stringify(data, null, 2));
}

export async function updateBotStatusMessage(channelId) {
  const remainingTime = await getRemainingTime();
  const statusMessageId = await getStatusMessageId();
  const statusMessageContent = `Time left: ${remainingTime.estimatedTimeToFinish} | Progress: ${remainingTime.progress} | Elapsed time: ${remainingTime.elapsedTime}`;

  const channel = await bot.channels.fetch(channelId);
  if (!channel.isTextBased()) {
    console.error('Specified channel is not a text channel');
    return;
  }

  if (statusMessageId) {
    try {
      const statusMessage = await channel.messages.fetch(statusMessageId);
      await statusMessage.edit(statusMessageContent);
      console.log(`Updated status message: ${statusMessageContent}`);
    } catch (error) {
      console.error(`Failed to edit status message: ${error}`);
      // If the message doesn't exist, send a new one
      const newStatusMessage = await channel.send(statusMessageContent);
      await saveStatusMessageId(newStatusMessage.id);
      console.log(`Sent new status message: ${statusMessageContent}`);
    }
  } else {
    const newStatusMessage = await channel.send(statusMessageContent);
    await saveStatusMessageId(newStatusMessage.id);
    console.log(`Sent new status message: ${statusMessageContent}`);
  }
}