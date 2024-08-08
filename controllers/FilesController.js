import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import dbClient, { ObjectId } from '../utils/db';
import redisClient from '../utils/redis';

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const key = `auth_${token}`;
    const userId = await redisClient.get(key);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    const acceptedTypes = ['folder', 'file', 'image'];
    if (!type || !acceptedTypes.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if ((type === 'file' || type === 'image') && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    let parentDocument = null;
    if (parentId !== 0) {
      parentDocument = await dbClient.db.collection('files').findOne({ _id: new ObjectId(parentId) });
      if (!parentDocument) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (parentDocument.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    const fileDocument = {
      userId: new ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentId !== 0 ? new ObjectId(parentId) : 0,
    };

    if (type === 'folder') {
      await dbClient.db.collection('files').insertOne(fileDocument);
      return res.status(201).json(fileDocument);
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const localPath = path.join(folderPath, uuidv4());
    fs.writeFileSync(localPath, Buffer.from(data, 'base64'));

    fileDocument.localPath = localPath;

    const result = await dbClient.db.collection('files').insertOne(fileDocument);
    fileDocument.id = result.insertedId.toString();
    delete fileDocument._id;
    return res.status(201).json(fileDocument);
  }

  static async getIndex(req, res) {
    const token = req.headers['x-token'];
    const { parentId = 0, page = 0 } = req.query;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const key = `auth_${token}`;
    const userId = await redisClient.get(key);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const pageNumber = parseInt(page, 10);
    // eslint-disable-next-line no-restricted-globals
    if (isNaN(pageNumber) || pageNumber < 0) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    const itemsPerPage = 20;
    const skip = pageNumber * itemsPerPage;

    const files = await dbClient.db.collection('files').aggregate([
      { $match: { userId: new ObjectId(userId), parentId: new ObjectId(parentId) } },
      { $sort: { name: 1 } },
      { $skip: skip },
      { $limit: itemsPerPage },
    ]).toArray();

    return res.status(200).json(files);
  }

  static async getShow(req, res) {
    const token = req.headers['x-token'];
    const { id } = req.params;

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const key = `auth_${token}`;
    const userId = await redisClient.get(key);

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const file = await dbClient.db.collection('files').findOne({
      _id: new ObjectId(id),
      userId: new ObjectId(userId),
    });

    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }

    return res.status(200).json(file);
  }
}
export default FilesController;
