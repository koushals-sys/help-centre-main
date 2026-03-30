import { config, fields, collection } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },

  collections: {
    docs: collection({
      label: 'Knowledge Base',
      slugField: 'title',
      path: 'src/content/docs/**',
      format: { contentField: 'content' },

      schema: {
        title: fields.text({
          label: 'Title',
        }),

        description: fields.text({
          label: 'Description',
        }),

        video: fields.text({
          label: 'Video',
        }),

        content: fields.document({
          label: 'Content',
          formatting: true,
          dividers: true,
          links: true,
          images: true,
        }),
      },
    }),
  },
});
