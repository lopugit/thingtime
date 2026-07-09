import { connect } from 'http2';
import { smarts } from '~/smarts';
import { stringLiteralToRichText } from '~/utils';

import cmdWatcher from './defaults/cmdWatcher';
import assets from '~/routes/branding/assets/all';

export const thingtimeMinimumValues: any = {
  settings: {
    logging: {
      all: false
    },
    types: {
      javascript: {
        any: {
          type: 'any',
          value: () => {
            return null;
          }
        },
        object: {
          type: 'object',
          value: () => {
            return {};
          }
        },
        array: {
          type: 'array',
          value: () => {
            return [];
          }
        },
        string: {
          type: 'string',
          value: () => {
            return '';
          }
        },
        number: {
          type: 'number',
          value: () => {
            return 0;
          }
        },
        boolean: {
          type: 'boolean',
          value: () => {
            return false;
          }
        },
        function: {
          type: 'function',
          value: () => {
            return () => {};
          }
        }
      },
      custom: {
        'Thingtime Logo': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Box',
            props: {
              fontSize: 12
            },
            rawChildren: ['🌈 Thingtime']
          }
        },
        'Violet Container Centered': {
          name: 'Violet Container Centered',
          type: 'chakra',
          icon: '💜',
          wrap: 'children',
          value: {
            name: 'Violet Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#AB47BC',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Indigo Container Centered': {
          name: 'Indigo Container Centered',
          type: 'chakra',
          icon: '🩷',
          wrap: 'children',
          value: {
            name: 'Indigo Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#5C6BC0',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Blue Container Centered': {
          name: 'Blue Container Centered',
          type: 'chakra',
          icon: '💙',
          wrap: 'children',
          value: {
            name: 'Blue Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#42A5F5',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Green Container Centered': {
          name: 'Green Container Centered',
          type: 'chakra',
          icon: '💚',
          wrap: 'children',
          value: {
            name: 'Green Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#66BB6A',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Yellow Container Centered': {
          name: 'Yellow Container Centered',
          type: 'chakra',
          icon: '💛',
          wrap: 'children',
          value: {
            name: 'Yellow Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#FFEE58',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Orange Container Centered': {
          name: 'Orange Container Centered',
          type: 'chakra',
          icon: '🧡',
          wrap: 'children',
          value: {
            name: 'Orange Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#FF7043',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Red Container Centered': {
          name: 'Red Container Centered',
          type: 'chakra',
          icon: '❤️',
          wrap: 'children',
          value: {
            name: 'Red Container Centered',
            type: 'chakra',
            chakra: 'Center',
            props: {
              bg: '#C62828',
              padding: 4,
              borderRadius: 12
            },
            children: []
          }
        },
        'Left Aligned': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Flex',
            props: {
              mr: 'auto'
            },
            children: []
          }
        },
        'Right Aligned': {
          type: 'chakra',
          value: {
            type: 'chakra',
            chakra: 'Flex',
            props: {
              ml: 'auto'
            },
            children: []
          }
        }
      }
    }

    // undoLimit: 999,
    // commander: {
    //   nav: {
    //     commanderActive: false,
    //     clearCommanderOnToggle: true,
    //     clearCommanderContextOnToggle: true,
    //     hideSuggestionsOnToggle: true,
    // },
    // },
  },
  //   Content: {
  //     hidden1: "Edit this to your heart's desire.",
  //     "How?": "Just search for Content and edit the value to whatever you want.",
  //     "Example:": `Content = New Content!
  // Content.Nested Content = New Nested Content!
  //     `,
  //   },
  devKit: {
    testUsers: {
      default: {
        username: 'rick.deckard',
        password: 'password'
      }
    }
  }
};

export const thingtimeOverwriteAll = {
  terms: {
    hiddenContent1: stringLiteralToRichText(`
    
      End User Terms
      
      Last updated: February 21, 2025

      These End User Terms are provided for informational purposes only and are not legal advice. These terms are not intended to and in no way establish an attorney-client relationship between you and the Creator.

      Welcome, and thank you for your interest in Thingtime ("Creator", "we", or "us") and our website at https://merch.thingtime.com, powered by TeePublic, (the "Service"). These Terms of Service are a legally binding contract between you and Creator regarding your use of the Service.

      1. Creator Service Overview

      You can purchase products from Thingtime by using a valid credit card or a third-party payment processor. You do not have to be a registered user to purchase a product. The price you pay at the checkout is determined by the Creator and is fixed at the time of ordering.

      You may not cancel an order once it has been submitted. It is your responsibility to ensure your Product delivery address is correct. We or and any other third parties take no responsibility for any Product you do not receive - or receive late - in connection with the delivery address you provide including, but not limited to, errors in the address you provide.

      Delivery of purchased product (s) will be facilitated pursuant to your instructions by postal or courier service and will be paid for by you at the amount that is indicated at the time of purchase. Shipping charges will be applied to the order, which will vary depending upon multiple factors, like location and the size and price of the product.

      2. Eligibility

      By agreeing to these Terms, you confirm that you are at least 16 years old. If you are under 18, your parent or guardian consents to these Terms. If you are an entity, organization, or company, the person accepting these Terms on your behalf confirms they have the authority to bind you to these Terms, and you agree to be bound by them.

      EU/EEA users: Minors are not permitted to use the Marketplace under any circumstances.

      3. Creating and Maintaining Your Account

      If you wish to register an account, you may be required to provide us with some information about yourself, such as your name, email address, and postal address. You agree that the information you provide to us is accurate and that you will keep it accurate and up-to-date at all times. When you register, you will be asked to provide a password. You are solely responsible for maintaining the confidentiality of your account and password, and you accept responsibility for all activities that occur under your account. If you encounter any security issues or similar, please notify us at dasherysupport@teepublic.com.

      4. Payment Terms

      We will determine pricing for all products and make reasonable efforts to keep pricing information published on the website up to date. We may make promotional efforts with different features and different pricing to any of our customers. You authorize the Creator and its third party payment processors to charge all sums for the Products you purchase, including all applicable taxes, to the payment method specified in your account.

      5. Returns and Refunds

      If you receive a damaged product, you must report the incident and the nature of the damage to customer service within 30 days of receipt. Upon verification, you may be issued a replacement order or a voucher, including shipping fees. You may be required to provide reasonable proof of the damage, such as a photo of the damaged product or by returning the damaged product itself.

      If you wish to set up an exchange, please contact customer support at dasherysupport@teepublic.com.Once an item has been exchanged, it is no longer eligible for a return for a refund. Any refund issued will be for the purchase price minus the original shipping fees.

      If you received a defective item or you have trouble setting up an exchange, please get in touch with us via the Contact Form.

      6. Intellectual Property Rights and Licenses

      We grant you, solely for your personal, non-commercial use, a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service.

      Unless prohibited by applicable law, you are not permitted to: (a) reproduce, distribute, publicly display, or perform the Service; (b) modify the Service; or (c) interfere with or bypass any feature of the Service, including security or access controls. If applicable law prevents you from using the Service, you must not use it.

      7. Proprietary Rights

      The Creator owns and operates the Service. The visual interfaces, graphics, design, compilation, information, data, computer code (including source and object code), products, software, services, and all other components of the Service and Products ("Materials") provided by the Creator are protected by intellectual property and other laws. All Materials within the Service are owned by the Creator or its third-party licensors. Unless explicitly authorized by the Creator, you are not permitted to use the Materials. The Creator retains all rights to the Materials not specifically granted in these Terms.

      8. User Conduct

      By using the Service you agree not to:

      engage in any illegal activities or violate any applicable laws, whether local, state, national, or international.
      infringe upon or encourage others to infringe upon the rights of third parties, including intellectual property rights.
      tamper with the Service's security features, such as by: (i) disabling or bypassing features that restrict content use or copying; or (ii) reverse engineering or attempting to uncover the Service's source code, unless permitted by law.
      disrupt the Service's operation or other users' experience, including by: (i) spreading viruses, adware, spyware, worms, or other harmful code; (ii) sending unsolicited offers or ads to other users; (iii) collecting personal data from users or third parties without consent; or (iv) disrupting networks, equipment, or servers connected to the Service.
      engage in fraudulent activities, such as impersonating others, falsely affiliating with entities, accessing other users' accounts without permission, or falsifying personal information like age or birthdate.
      sell or transfer the access rights granted under these Terms, or any Materials or rights to view, access, or use such Materials.
      attempt or assist others in performing any of the actions described in Section 7 above.
      9. Amendments

      We reserve the right to change these Terms and our policies on a going-forward basis at any time.

      10. Termination

      Creator or Dashery may, at either of their sole discretion, terminate these Terms or your account on the Service, or suspend or terminate your access to the Service, at any time for any reason or no reason, with or without notice. You may terminate your account and these Terms at any time by contacting customer service at dasherysupport@teepublic.com.

      Terms and conditions that by their nature would reasonably be expected to survive termination shall survive termination and remain in full force and effect notwithstanding full or partial termination of this End User Agreement including, but not limited to, your indemnities, your grant of rights and licenses, our disclaimers and limitations of liability, and your representations and warranties.

      You may terminate your account at any time by logging into your account, clicking on the "Delete Account" link and then following the instructions. Upon termination of these Terms, (a) you must immediately cease all use of the Service; (b) you will no longer be authorized to access your account or the Service; and (c) you must pay Creator any unpaid amount that was due prior to termination.

      11. Indemnity

      To the fullest extent permitted by law, you are responsible for your use of the Service, and you will defend and indemnify Creator and its officers, directors, employees, consultants, affiliates, subsidiaries and agents, Dashery, TP Apparel LLC and Redbubble Inc. (together, the "Creator Entities" from and against every claim brought by a third party, and any related liability, damage, loss, and expense, including reasonable attorneys’ fees and costs, arising out of or connected with: (a) your unauthorized use of, or misuse of, the Service; (b) your violation of any portion of these Terms, any representation, warranty, or agreement referenced in these Terms, or any applicable law or regulation; (c) your violation of any third party right, including any intellectual property right or publicity, confidentiality, other property, or privacy right; or (d) any dispute or issue between you and any third party. We reserve the right, at our own expense, to assume the exclusive defense and control of any matter otherwise subject to indemnification by you (without limiting your indemnification obligations with respect to that matter), and in that case, you agree to cooperate with our defense of those claims.

      12. Disclaimers; No Warranties

      You must ensure that your access to the Services and your use of the Services is not prohibited by law. It is your responsibility to ensure that the process that you employ for accessing the Creator Site and Services does not expose you to risk of viruses, malicious computer code or other forms of interference that may damage your computer system. We do not accept responsibility for any interference or damage to any computer system that arises in connection with your use of the Creator Site or the Services.

      The Creator Site and Services are provided on an ‘as is’ basis. We do not represent or guarantee that the Creator Site or the Services will be free from errors or viruses. We do not represent or guarantee that access to the Creator Site or the Services will be uninterrupted.

      We do not make any warranties or representations regarding any content uploaded to the Creator Sites including, but not limited to, that it will be protected against loss, theft, misuse or alteration by third parties. We do not accept any liability to you or any third parties for any losses arising directly or indirectly from a failure to provide the Services, corruption to or loss of data, errors or interruptions, any suspension or discontinuance of the Services, or any transmissions or Content of others in contravention of these Terms.

      We have no responsibility for any loss or damage, however caused (including through negligence), that you may directly or indirectly suffer in connection with your use of the Creator Site including, but not limited to, purchasing products, nor do we have any responsibility for any such loss arising out of your use of or reliance on any content or other information contained on or accessed through the Services.

      WITHOUT LIMITING THE DISCLAIMER OF WARRANTIES CONTAINED IN THIS USER AGREEMENT AND TO THE FULLEST EXTENT PERMITTED BY LAW, WE MAKE NO REPRESENTATIONS, WARRANTIES, OR CONDITIONS OF ANY KIND, EXPRESS OR IMPLIED, WITH RESPECT TO THE CREATOR SITE OR THE SERVICES, INCLUDING WITHOUT LIMITATION, ANY EXPRESS OR IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

      YOU HEREBY ACKNOWLEDGE THAT NEITHER TP APPAREL LLC NOR DASHERY IS A PARTY TO, AND NEITHER WILL HAVE ANY LIABILITY RESULTING FROM, THESE TERMS, ANY DAMAGES OR LOSSES YOU INCUR AS A RESULT OF USING THE SERVICE, OR THE PURCHASE OF PRODUCTS.

      This disclaimer set out in these Terms does not attempt or purport to exclude liability arising under statute if, and to the extent, such liability cannot be lawfully excluded.

      13. Miscellaneous

      13.1. Governing Law
      These Terms are governed by the laws of the State of New York without regard to conflict of law principles. You and Creator submit to the personal and exclusive jurisdiction of the state courts and federal courts located within New York, NY for resolution of any lawsuit or court proceeding permitted under these Terms.

      13.2. Additional Terms
      Your use of the Service is subject to all additional terms, policies, rules, or guidelines applicable to the Service or certain features of the Service that we may post on or link to from the Service (the “Additional Terms”). All Additional Terms are incorporated by this reference into, and made a part of, these Terms.

      13.3. Contact Information
      The Service is offered by Thingtime. You may contact us by sending correspondence by emailing us at dasherysupport@teepublic.com.

      13.4. Legal Notice
      If any provision of this End User Agreement is found to be invalid, unenforceable or unlawful, the full validity of the remaining provisions shall not be affected. In this case, the contracting parties shall be obliged to cooperate in the creation of provisions that achieve a legally effective result that comes as close as possible to the invalid provision.

      For more information on our Help Centre (including the existing contact options), please visit this link.
    
    
    `)
  },
  privacy: {
    hiddenContent1: stringLiteralToRichText(`
      🔐 Privacy Policy

      Effective Date: 01/01/2025

      At Thingtime, we respect your privacy.

      We do not collect, store, or share any personal information.

      We don’t use tracking cookies, and we don’t retain any user data on our servers beyond what’s necessary to make the site and tools function (such as temporary technical logs or authentication via third-party providers, if used).

      If we ever introduce features that require data storage or tracking, we’ll update this policy and communicate any changes clearly.

      If you have any questions, feel free to contact us at contact@thingtime.com
    `)
  },
  assets,
  branding: assets,
  cmdWatcher
};

// if the users local thingtime version is less than the new version then these values will overwrite any older values
// TODO: implement patch system the way blockchain does..
// db migration theory
export const thingtimeNewData = {};

const versions = [
  {
    version: 26,
    settings: {
      theme: {
        preset: 'Thingtime',
        overrides: {}
      }
    }
  },
  {
    version: 25,
    settings: {
      connectionUrls: ['mongodb://localhost:27017']
    }
  },
  {
    version: 24,
    Content: {
      hidden1: "Edit this to your heart's desire.",
      'How?': 'Just search for Content and edit the value to whatever you want.',
      'Example:': `Content = New Content!
      Content.Nested Content = New Nested Content!
    `
    }
  }
];

// merge all versions into one object using smarts.merge
export const mergedVersions = versions.reduce((acc, version) => {
  return smarts.merge(acc, version);
}, {});

const defaultValues = {
  settings: {
    visual: {
      bottomPadding: 72
    },
    commander: {
      nav: {
        commanderActive: false,
        clearCommanderOnToggle: true,
        clearCommanderContextOnToggle: true,
        hideSuggestionsOnToggle: true
      }
    },
    drawer: {
      open: false,
      width: 300,
      opens: {
        direction: 'left'
      },
      toplevelitems: {
        limit: 'unlimited'
      },
      searchClosesDrawer: true,
      userDrawerOrdering: {},
      selectedItem: 'home',
      collapsedGroups: {}
    },
    theme: {
      preset: 'Thingtime',
      overrides: {}
    },
    connectionUrls: ['mongodb://localhost:27017']
  },
  Content: {
    hidden1: "Edit this to your heart's desire.",
    'How?': 'Just search for Content and edit the value to whatever you want.',
    'Example:': `
Content = New Content!
Content.Nested Content = New Nested Content!
    `
  }
};

// const thingtimeDefaultsWithMinimumValues = smarts.merge(defaultValues, thingtimeMinimumValues);
export const thingtimeDefaults = smarts.merge(thingtimeMinimumValues, defaultValues);

// export const thingtimeDefaults = smarts.merge(thingtimeDefaultsWithMinimumValues, thingtimeOverwrite, {
//   overwriteAll: true,
//   clone: true
// });

// initialise thingtime
thingtimeDefaults.thingtime = thingtimeDefaults;
thingtimeDefaults.tt = thingtimeDefaults;

export default thingtimeDefaults;
