import 'dotenv/config'
import { combineStreams } from './scripts/combineStreams'
import fastify, { FastifyInstance } from 'fastify'
import ffmpeg from 'fluent-ffmpeg'
import ytdl from 'ytdl-core'
import fs from 'fs'

const app: FastifyInstance = fastify()

interface IQuality {
  itag: number
  quality: string
  fileSize?: number
}

interface IVideoInfo {
  title: string
  thumbnail: string
  duraction: string
  mp4Qualities: IQuality[]
  mp3Qualities: IQuality[]
}

const MP4Order = [137, 136, 135, 18, 160]
const MP3Order = [320, 256, 192, 128, 64]

const MP4itags = {
  137: '1080p',
  136: '720p',
  135: '480p',
  18: '360p',
  160: '144p',
}

const MP3bitrates = {
  320: '320kbps',
  256: '256kbps',
  192: '192kbps',
  128: '128kbps',
  64: '64kbps',
}

app.addHook('onRequest', (request, reply, done) => {
  reply.header('Access-Control-Allow-Origin', 'http://172.17.0.157')
  reply.header('Access-Control-Allow-Methods', 'GET, POST')
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (request.method === 'OPTIONS') {
    reply.status(200).send()
  } else {
    done()
  }
})

app.get('/info/:id', async (request, reply) => {

  const { id } = request.params as { id: string }

  const info = await ytdl.getBasicInfo(id).catch(() => {
    return reply.status(404).send({ error: 'Video not founded' })
  })

  const mp4Qualities: IQuality[] = []

  info.formats.forEach((format) => {
    if (format.mimeType?.includes('video/mp4') && format.itag in MP4itags) {
      mp4Qualities.push({
        itag: format.itag,
        quality: MP4itags[format.itag as keyof typeof MP4itags],
        fileSize: Number(format.contentLength) / 1048576,
      })
    }
  })

  const audioFormat = info.formats.find((format) => {
    return format.mimeType?.includes('audio/mp4')
  })

  const audioSeconds = Number(audioFormat?.approxDurationMs) / 1000

  const mp3Qualities: IQuality[] = []

  MP3Order.forEach((bitrate) => {
    mp3Qualities.push({
      itag: bitrate,
      quality: MP3bitrates[bitrate as keyof typeof MP3bitrates],
      fileSize: (audioSeconds * (bitrate * 1000)) / (8 * 1024 * 1024),
    })
  })!

  const sortedMp4Qualities: IQuality[] = mp4Qualities.sort((a, b) => {
    return MP4Order.indexOf(a.itag) - MP4Order.indexOf(b.itag)
  })

  const videoInfo: IVideoInfo = {
    title: info.videoDetails.title,
    thumbnail:
      info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
    duraction: info.videoDetails.lengthSeconds,
    mp4Qualities: sortedMp4Qualities,
    mp3Qualities,
  }

  reply.header('Content-Type', 'application/json; charset=utf-8')
  reply.send(videoInfo)
})

app.get('/download/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const { quality } = request.query as { quality: number }

  if (!quality) {
    return reply.status(400).send({ error: 'Quality not provided' })
  }

  if (!(quality in MP4itags)) {
    return reply.status(400).send({ error: 'Quality not allowed' })
  }

  const info = await ytdl.getInfo(id).catch(() => {
    return reply.status(404).send({ error: 'Video not founded' })
  })

  if (info.formats.every((format) => format.itag !== Number(quality))) {
    return reply.status(404).send({ error: 'Quality not founded' })
  }

  if (Number(info.videoDetails.lengthSeconds) > 600) {
    return reply.status(413).send({ error: 'Video too long' })
  }

  const videoStream = ytdl.downloadFromInfo(info, {
    format: 'mp4' as unknown as ytdl.videoFormat,
    quality,
  })

  const audioStream = ytdl.downloadFromInfo(info, {
    filter: 'audioonly',
    quality: 'highestaudio',
  })

  const filePath = `src/temp/output_${Date.now()}.mp4`

  try {
    await combineStreams(audioStream, videoStream, filePath)
    const fileStream = fs.createReadStream(filePath)

    fileStream.on('close', () => {
      fs.unlinkSync(filePath)
    })

    reply.type('video/mp4')
    reply.header(
      'Content-Disposition',
      `attachment; filename="${Date.now()}-ytgrab.mp4"`,
    )
    await reply.send(fileStream)
  } catch (err) {
    return reply.status(500).send({ error: 'Internal server error' })
  }
})

app.get('/downloadAudio/:id', async (request, reply) => {
  const { id } = request.params as { id: string }
  const { bitrate } = request.query as { bitrate: number }

  if (!bitrate) {
    return reply.status(400).send({ error: 'Bitrate not provided' })
  }

  if (!(bitrate in MP3bitrates)) {
    return reply.status(400).send({ error: 'Bitrate not allowed' })
  }

  const info = await ytdl.getInfo(id).catch(() => {
    return reply.status(404).send({ error: 'Video not founded' })
  })

  if (Number(info.videoDetails.lengthSeconds) > 600) {
    return reply.status(413).send({ error: 'Video too long' })
  }

  const videoStream = ytdl.downloadFromInfo(info, {
    filter: 'audioonly',
    quality: 'highestaudio',
  })

  const ffmpegCommand = ffmpeg(videoStream).audioBitrate(bitrate).format('mp3')

  reply.type('audio/mp3')
  reply.header(
    'Content-Disposition',
    `attachment; filename="${Date.now()}-ytgrab.mp4"`,
  )
  await reply.send(ffmpegCommand)
})

app
  .listen({
    port: 3333,
  })
  .then(() => {
    console.log('HTTP Server Running!')
  })
