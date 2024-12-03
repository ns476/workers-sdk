import { File } from "buffer";
import { ImageInfoResponse } from "@cloudflare/workers-types/experimental";
import sharp, { Sharp } from "sharp";

export async function imagesLocalFetcher(request: Request): Promise<Response> {
	const data = await request.formData();

	const body = data.get("image");
	if (!body || !(body instanceof File)) {
		return errorResponse(400, 9523, "ERROR: Expected image in request");
	}

	const transformer = sharp(await body.arrayBuffer(), {});

	const url = new URL(request.url);

	if (url.pathname == "/info") {
		return info(transformer);
	} else {
		const badTransformsResponse = errorResponse(
			400,
			9523,
			"ERROR: Expected JSON transforms in transforms field"
		);
		try {
			const transforms = JSON.parse((data.get("transforms") as string) || "");
			if (!(transforms instanceof Array)) {
				return badTransformsResponse;
			}
			return transform(
				transformer,
				transforms,
				(data.get("output_format") as string) || ""
			);
		} catch (e: any) {
			return badTransformsResponse;
		}
	}
}

async function info(transformer: Sharp): Promise<Response> {
	let metadata = await transformer.metadata();

	let mime: string | null = null;
	switch (metadata.format) {
		case "jpeg":
			mime = "image/jpeg";
			break;
		case "svg":
			mime = "image/svg+xml";
			break;
		case "png":
			mime = "image/png";
			break;
		case "webp":
			mime = "image/webp";
			break;
		case "gif":
			mime = "image/gif";
			break;
		case "avif":
			mime = "image/avif";
			break;
		default:
			return errorResponse(415, 9520, "ERROR: Unsupported image type");
	}

	let resp: ImageInfoResponse;
	if (mime == "image/svg+xml") {
		resp = {
			format: mime,
		};
	} else {
		if (!metadata.size || !metadata.width || !metadata.height) {
			return errorResponse(
				500,
				9523,
				"ERROR: Expected size, width and height for bitmap input"
			);
		}

		resp = {
			format: mime,
			fileSize: metadata.size,
			width: metadata.width,
			height: metadata.height,
		};
	}

	return Response.json(resp);
}

async function transform(
	transformer: Sharp,
	transforms: any[],
	outputFormat: string | null
): Promise<Response> {
	for (const transform of transforms) {
		let height: number | null = null;
		let width: number | null = null;
		let rotate: number | null = null;
		if (transform.imageIndex && transform.imageIndex != 0) {
			// This transform doesn't apply to the main image,
            // and we don't support draws, ignore it
			continue;
		}

		if (transform.width && typeof transform.width === "number") {
			width = transform.width;
		}
		if (transform.height && typeof transform.height === "number") {
			height = transform.height;
		}
		if (transform.rotate && typeof transform.rotate === "number") {
			rotate = transform.rotate;
		}

		if (rotate != null) {
			transformer.rotate(rotate);
		}

		if (width != null || height != null) {
			transformer.resize(width, height, {
				fit: "contain",
			});
		}
	}

	switch (outputFormat) {
		case "image/avif":
			transformer.avif();
			break;
		case "image/gif":
			return errorResponse(
				415,
				9520,
				"ERROR: GIF output is not supported in local mode"
			);
		case "image/jpeg":
			transformer.jpeg();
			break;
		case "image/png":
			transformer.png();
			break;
		case "image/webp":
			transformer.webp();
			break;
		case "rgb":
		case "rgba":
			return errorResponse(
				415,
				9520,
				"ERROR: RGB/RGBA output is not supported in local mode"
			);
		default:
			outputFormat = "image/jpeg";
			break;
	}

	return new Response(transformer, {
		headers: {
			"content-type": outputFormat,
		},
	});
}

function errorResponse(status: number, code: number, message: string) {
	return new Response(`ERROR ${code}: ${message}`, {
		status,
		headers: {
			"content-type": "text/plain",
			"cf-images-binding": `err=${code}`,
		},
	});
}
