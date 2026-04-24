import type {
  Adapter,
  GeneratedAdapter,
} from '@payloadcms/plugin-cloud-storage/types'
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'

type CloudinaryAdapterArgs = {
  cloudName: string
  apiKey: string
  apiSecret: string
  folder?: string
}

type CloudinaryResourceType = 'image' | 'video' | 'raw'

const VIDEO_EXT = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv', 'ogv', '3gp',
])
const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'tif', 'ico', 'heic', 'heif',
])

const getExt = (filename: string): string =>
  (filename.split('.').pop() ?? '').toLowerCase()

const detectResourceType = (filename: string): CloudinaryResourceType => {
  const ext = getExt(filename)
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  return 'raw'
}

const stripExt = (filename: string): string => filename.replace(/\.[^.]+$/, '')

const buildPublicId = (
  folder: string,
  filename: string,
  resourceType: CloudinaryResourceType,
): string => {
  // raw assets keep extension in public_id; image/video do not
  const base = resourceType === 'raw' ? filename : stripExt(filename)
  return `${folder}/${base}`
}

const getCloudinary = (args: CloudinaryAdapterArgs) => {
  cloudinary.config({
    cloud_name: args.cloudName,
    api_key: args.apiKey,
    api_secret: args.apiSecret,
    secure: true,
  })
  return cloudinary
}

export const cloudinaryAdapter = (args: CloudinaryAdapterArgs): Adapter => {
  const folder = args.folder ?? 'payload-media'

  return ({ collection: _collection, prefix }): GeneratedAdapter => {
    const client = getCloudinary(args)
    const resolvedFolder = prefix ? `${folder}/${prefix}` : folder

    return {
      name: 'cloudinary',
      handleUpload: async ({ file, data }) => {
        const resourceType = detectResourceType(file.filename)
        const publicId = resourceType === 'raw' ? file.filename : stripExt(file.filename)

        const result = await new Promise<UploadApiResponse>((resolve, reject) => {
          const stream = client.uploader.upload_stream(
            {
              folder: resolvedFolder,
              public_id: publicId,
              resource_type: resourceType,
              overwrite: true,
              use_filename: false,
              unique_filename: false,
            },
            (err, res) => {
              if (err || !res) return reject(err ?? new Error('Cloudinary upload failed'))
              resolve(res)
            },
          )
          stream.end(file.buffer)
        })

        data.cloudinaryURL = result.secure_url
        data.cloudinaryPublicID = result.public_id
        data.cloudinaryResourceType = result.resource_type
        return data
      },
      handleDelete: async ({ doc }) => {
        const publicId = (doc as { cloudinaryPublicID?: string }).cloudinaryPublicID
        const resourceType =
          (doc as { cloudinaryResourceType?: string }).cloudinaryResourceType ?? 'image'
        if (!publicId) return
        await client.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true })
      },
      generateURL: ({ filename }) => {
        const resourceType = detectResourceType(filename)
        const publicId = buildPublicId(resolvedFolder, filename, resourceType)
        return client.url(publicId, { secure: true, resource_type: resourceType })
      },
      staticHandler: async (_req, { params }) => {
        const filename = (params as { filename?: string })?.filename
        if (!filename) return new Response('Not found', { status: 404 })
        const resourceType = detectResourceType(filename)
        const publicId = buildPublicId(resolvedFolder, filename, resourceType)
        const url = client.url(publicId, { secure: true, resource_type: resourceType })
        return Response.redirect(url, 302)
      },
      fields: [
        {
          name: 'cloudinaryURL',
          type: 'text',
          admin: { readOnly: true, hidden: true },
        },
        {
          name: 'cloudinaryPublicID',
          type: 'text',
          admin: { readOnly: true, hidden: true },
        },
        {
          name: 'cloudinaryResourceType',
          type: 'text',
          admin: { readOnly: true, hidden: true },
        },
      ],
    }
  }
}
