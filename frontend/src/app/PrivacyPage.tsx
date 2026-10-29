/**
 * 数据处理说明。
 *
 * 首次使用的同意门禁与设置里的查阅入口共用本页内容：一份说明只有一个来源，
 * 两处各写一份，迟早会在「到底承诺了什么」上分叉。
 */
import { Link } from 'react-router'

export function PrivacyPage() {
  return (
    <main className="page">
      <header className="page__header">
        <Link className="page__back" to="/settings">
          ‹ 设置
        </Link>
        <h1>数据处理说明</h1>
      </header>

      <section className="group">
        <h2 className="group__title">数据存在哪里</h2>
        <p className="group__note">
          训练、体重与饮食记录只存在这台设备的浏览器里，不会上传到服务器。
        </p>
        <p className="group__note">
          这意味着清理浏览器缓存、卸载浏览器或更换设备都会导致数据丢失。
          建议每周导出一次，导出文件可以再导入回来。
        </p>
      </section>

      <section className="group">
        <h2 className="group__title">什么会被上传</h2>
        <p className="group__note">
          语音识别与饮食拍照识别会把录音、图片或文字发送到第三方服务用于识别，
          请求中不包含设备标识、位置或身份信息，服务端不会留存原图。
        </p>
        <p className="group__note">不联网时这些功能不可用，其余记录功能照常工作。</p>
      </section>

      <section className="group">
        <h2 className="group__title">你的权利</h2>
        <p className="group__note">
          随时可以在「导出与导入」里导出全部数据，也可以一键清空全部数据。
          清空不可撤销。
        </p>
      </section>

      <section className="group">
        <h2 className="group__title">适用人群</h2>
        <p className="group__note">本产品不面向 18 岁以下人群。</p>
      </section>
    </main>
  )
}
