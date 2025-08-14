import VideoDetailClient from "./VideoDetailClient";

export default async function Page({ params }: { params: { key: string } }) {
  const key = await decodeURIComponent(params.key);
  return <VideoDetailClient videoKey={key} />;
}


