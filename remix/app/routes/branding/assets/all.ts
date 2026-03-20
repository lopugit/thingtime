const assets = [
  {
    name: 'Thingtime Logo',
    description: 'The official Thingtime logo',
    type: 'image/svg+xml',
    url: '/branding/thingtime-horizontal.svg',
    render: {
      svg: {
        render: {
          type: 'chakra',
          chakra: 'Image',
          props: {
            src: '/branding/thingtime-horizontal.svg',
            alt: 'Thingtime Logo',
            boxSize: '200px',
            objectFit: 'contain'
          }
        }
      },
      png: {
        render: {
          exec: async (data) => {
            if (data.props?.src) {
              return data;
            }

            const svgToPng = async (relativeUrl: string, scale = 4) =>
              new Promise<string>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');

                  canvas.width = img.width * scale;
                  canvas.height = img.height * scale;

                  ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                  const dataUrl = canvas.toDataURL('image/png');
                  console.log('Thingtime svgToPng dataUrl:', dataUrl);
                  resolve(dataUrl);
                };
                img.onerror = reject;
                img.src = relativeUrl;
              });

            const pngDataUrl = await svgToPng(data.src, 2);
            const newData = { ...data };

            // console log pngDataUrl
            console.log('Thingtime pngDataUrl:', pngDataUrl);

            // set data.props.src to png data url
            newData.props.src = pngDataUrl;
            return newData;
          },
          type: 'chakra',
          chakra: 'Image',
          src: '/branding/thingtime-horizontal.svg', // use the svg url as the source for the png renderer, it will be converted in the exec function
          // automatically convert the url to png using built in library
          props: {
            // use "onload to convert svg to png"
            alt: 'Thingtime Logo',
            boxSize: '200px',
            objectFit: 'contain'
          }
        }
      }
    }
  }
];

export default assets;
