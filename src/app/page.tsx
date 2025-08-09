import EnterpriseUploader from "./components/EnterpriseUploader";
import VideoGallery from "./components/VideoGallery";

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>视频上传到 AWS S3</h1>
      <EnterpriseUploader />
      <VideoGallery />
    </main>
  )
}
