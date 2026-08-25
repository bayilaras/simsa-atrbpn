// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Panduan SIMSA',
  tagline: 'Sistem Informasi Manajemen Surat & Arsip — Kementerian ATR/BPN',
  favicon: 'img/favicon.ico',

  url: 'https://panduan-simsa.vercel.app',
  baseUrl: '/',

  organizationName: 'bayilaras',
  projectName: 'simsa-atrbpn',

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'id',
    locales: ['id'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'light',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Panduan SIMSA',
        logo: {
          alt: 'SIMSA Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'panduanSidebar',
            position: 'left',
            label: 'Panduan',
          },
          {
            href: 'https://simsa-frontend.vercel.app',
            label: 'Buka SIMSA',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Panduan',
            items: [
              { label: 'Selamat Datang', to: '/' },
              { label: 'Surat Masuk', to: '/manajemen-surat/surat-masuk' },
              { label: 'Arsip Aktif', to: '/siklus-arsip/arsip-aktif' },
            ],
          },
          {
            title: 'Akses',
            items: [
              { label: 'Login Google', to: '/akses-simsa/login-google' },
              { label: 'Role & Hak Akses', to: '/tutorial-dasar/role-hak-akses' },
            ],
          },
          {
            title: 'Lainnya',
            items: [
              {
                label: 'Buka SIMSA',
                href: 'https://simsa-frontend.vercel.app',
              },
            ],
          },
        ],
        copyright: `© ${new Date().getFullYear()} Kementerian Agraria dan Tata Ruang / BPN — SIMSA v1.0.0`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
      tableOfContents: {
        minHeadingLevel: 2,
        maxHeadingLevel: 4,
      },
    }),
};

export default config;
