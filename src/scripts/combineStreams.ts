import { Readable } from 'node:stream'
import cp from 'child_process'

export async function combineStreams(
  audioStream: Readable,
  videoStream: Readable,
  filePath: string,
) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = cp.spawn('ffmpeg', [
      '-i',
      'pipe:0', // Áudio stream como entrada
      '-i',
      'pipe:1', // Vídeo stream como entrada
      '-c:v',
      'copy', // Copiar o fluxo de vídeo sem re-encode
      '-c:a',
      'aac', // Re-encode o fluxo de áudio para AAC
      '-map',
      '0:a', // Mapear o primeiro stream de áudio
      '-map',
      '1:v', // Mapear o primeiro stream de vídeo
      '-movflags',
      '+faststart', // Mover os metadados para o início do arquivo
      filePath, // Saída do arquivo
    ])

    ffmpeg.on('error', (err) => {
      reject(err)
    })

    ffmpeg.on('exit', (code, signal) => {
      if (code === 0) {
        resolve()
      } else {
        console.error(
          `Combinação finalizada com código de saída ${code} e sinal ${signal}`,
        )
        reject(
          new Error(
            `Erro ao combinar streams. Código de saída: ${code}, Sinal: ${signal}`,
          ),
        )
      }
    })

    audioStream.pipe(ffmpeg.stdio[0])
    videoStream.pipe(ffmpeg.stdio[1])
  })
}
