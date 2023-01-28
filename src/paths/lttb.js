import { abs, floor } from '../utils';

// adapted from https://github.com/pingec/downsample-lttb
export function lttb(data, threshold) {
    let [ dataX, dataY ] = data;
	let len = dataX.length;

	if (threshold >= len || threshold == 0) {
		return data;
	}

	let sampled = [
        Array(len),
        Array(len),
    ];

    let [ sampledX, sampledY ] = sampled;

    let sampled_index = 0;

	// Bucket size. Leave room for start and end data points
	let every = (len - 2) / (threshold - 2);

	let a = 0,  // Initially a is the first point in the triangle
		max_area_index,
		max_area,
		area,
		next_a;

    // Always add the first point
	sampledX[ sampled_index ] = dataX[ a ];
    sampledY[ sampled_index ] = dataY[ a ];
    sampled_index++;

	for (let i = 0; i < threshold - 2; i++) {
        // if (dataY[i] == null) continue; //or add to array?

		// Calculate point average for next bucket (containing c)
		let avg_x = 0,
			avg_y = 0,
			avg_range_start  = floor( ( i + 1 ) * every ) + 1,
			avg_range_end    = floor( ( i + 2 ) * every ) + 1;

		avg_range_end = avg_range_end < len ? avg_range_end : len;

		let avg_range_length = avg_range_end - avg_range_start;

		for ( ; avg_range_start < avg_range_end; avg_range_start++ ) {
		  avg_x += dataX[ avg_range_start ];
		  avg_y += dataY[ avg_range_start ];
		}

		avg_x /= avg_range_length;
		avg_y /= avg_range_length;

		// Get the range for this bucket
		let range_offs = floor( (i + 0) * every ) + 1,
			range_to   = floor( (i + 1) * every ) + 1;

		// Point a
		let point_a_x = dataX[ a ],
			point_a_y = dataY[ a ];

		max_area = area = -1;

		for ( ; range_offs < range_to; range_offs++ ) {
			// Calculate triangle area over three buckets
			area = abs( ( point_a_x - avg_x ) * ( dataY[ range_offs ] - point_a_y ) -
						( point_a_x - dataX[ range_offs ] ) * ( avg_y - point_a_y )
					  ) * 0.5;

			if ( area > max_area ) {
				max_area = area;
				max_area_index = range_offs;
				next_a = range_offs; // Next a is this b
			}
		}

		sampledX[ sampled_index ] = dataX[max_area_index];
        sampledY[ sampled_index ] = dataY[max_area_index];
        sampled_index++;

		a = next_a; // This a is the next a (chosen b)
	}

    // Always add last
    sampledX[ sampled_index ] = dataX[len - 1];
    sampledY[ sampled_index ] = dataY[len - 1];

	return sampled;
}
