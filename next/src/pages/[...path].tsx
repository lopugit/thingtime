import { ThingtimeURL } from '~/components/Thingtime/ThingtimeURL';
export default function Index(props: any) {
  console.log('nik 3 props', props);

  return <ThingtimeURL path={props?.path}></ThingtimeURL>;
}

export async function getServerSideProps(context: any) {
  return {
    props: {
      path: context?.params?.path // Access dynamic route parameters
    }
  };
}
