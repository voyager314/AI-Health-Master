/**
 * 文件落盘接口。
 *
 * 编排层只依赖这个接口，不依赖具体的下载方式：浏览器里触发下载，测试里收集到内存。
 * 这样「导出前先备份再覆盖」这类顺序性规则可以在测试里断言，而不必真的下载文件。
 */
import type { ExportFile } from '@/domain'

export interface FileSink {
  /** 保存一个文件。失败时抛错，调用方据此认定这次导出没有完成 */
  save(file: ExportFile): Promise<void>
}

/**
 * 浏览器下载实现。
 *
 * 逐个文件发起下载。同一时刻连续触发多个下载时，部分浏览器会拦截后续的，
 * 因此调用方应按顺序逐个 await，而不是并发。
 */
export function createDownloadSink(): FileSink {
  return {
    async save(file) {
      const blob = new Blob([file.text], { type: file.mime })
      const url = URL.createObjectURL(blob)
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = file.filename
        link.rel = 'noopener'
        document.body.appendChild(link)
        link.click()
        link.remove()
      } finally {
        // 立即释放会让部分浏览器的下载中断，交给下一轮事件循环回收
        setTimeout(() => URL.revokeObjectURL(url), 0)
      }
    },
  }
}
