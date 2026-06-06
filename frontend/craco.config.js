module.exports = {
  webpack: {
    configure(webpackConfig) {
      if (webpackConfig.mode !== 'production') return webpackConfig;

      const { splitChunks } =
        webpackConfig.optimization || (webpackConfig.optimization = {});

      webpackConfig.output = {
        ...webpackConfig.output,
        globalObject: 'globalThis',
      };

      webpackConfig.optimization.splitChunks = {
        ...splitChunks,
        chunks: 'all',
        maxInitialRequests: 25,
        maxAsyncRequests: 30,
        minSize: 20_000,
        cacheGroups: {
          ...(splitChunks && splitChunks.cacheGroups),

          react: {
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            name: 'vendor-react',
            chunks: 'all',
            priority: 40,
            enforce: true,
          },

          router: {
            test: /[\\/]node_modules[\\/](react-router|react-router-dom)[\\/]/,
            name: 'vendor-router',
            chunks: 'all',
            priority: 35,
            enforce: true,
          },

          styledComponents: {
            test: /[\\/]node_modules[\\/](styled-components|stylis)[\\/]/,
            name: 'vendor-styled',
            chunks: 'all',
            priority: 30,
            enforce: true,
          },

          framerMotion: {
            test: /[\\/]node_modules[\\/](framer-motion|motion)[\\/]/,
            name: 'vendor-framer',
            chunks: 'all',
            priority: 30,
            enforce: true,
          },

          hlsJs: {
            test: /[\\/]node_modules[\\/]hls\.js[\\/]/,
            name: 'vendor-hls',
            chunks: 'async',
            priority: 30,
            enforce: true,
          },

          axios: {
            test: /[\\/]node_modules[\\/]axios[\\/]/,
            name: 'vendor-axios',
            chunks: 'all',
            priority: 25,
            enforce: true,
          },

          reactIcons: {
            test: /[\\/]node_modules[\\/]react-icons[\\/]/,
            name: 'vendor-icons',
            chunks: 'async',
            priority: 25,
            enforce: true,
          },

          vendorRest: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendor-misc',
            chunks: 'all',
            priority: 10,
            reuseExistingChunk: true,
          },
        },
      };

      return webpackConfig;
    },
  },
};
