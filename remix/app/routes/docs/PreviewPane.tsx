type PreviewFrameProps = {
  expanded?: boolean;
  height?: string;
  previewSrc: string;
  reloadToken?: number;
  testId: string;
  title: string;
};

export function PreviewFrame({
  expanded = false,
  height = '100%',
  previewSrc,
  reloadToken = 0,
  testId,
  title
}: PreviewFrameProps) {
  return (
    <iframe
      data-testid={testId}
      key={`${testId}-${previewSrc}-${reloadToken}`}
      src={previewSrc}
      title={`${title} preview`}
      allowFullScreen
      style={{
        border: 0,
        display: 'block',
        height: expanded ? 'calc(100vh - 56px)' : height,
        marginTop: expanded ? '56px' : 0,
        minHeight: 'inherit',
        width: '100%'
      }}
    />
  );
}
