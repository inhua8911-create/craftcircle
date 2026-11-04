# Photos for the demo shop

These are the photos from the original Makers Collective demo. `npm run seed` and `load-images` attach them by file name:

- **Products** `<product-name>.jpg`, for example `pineapple-charm-pearl-bracelet.jpg`. Extra photos: add `-2`, `-3` (`pineapple-charm-pearl-bracelet-2.jpg`).
- **Category banners** `jewellery.jpg`, `crochet.jpg`, `accessories.jpg`, `crafts.jpg`, `decor.jpg`. A product with no photo of its own uses its category photo.
- **Creator photos** `creator-meera-nair.jpg`, `creator-little-bloom-crafts.jpg`, `creator-aisha-khan.jpg`.

JPG, PNG or WebP, 5 MB max each. To swap a photo: replace the file (same name) and run `node server/dist/loadImages.js` from the project root.
Photos uploaded by creators through the app are never replaced.
