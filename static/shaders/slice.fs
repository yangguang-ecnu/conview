#ifdef GL_ES
precision highp float;
#endif

uniform int uColorMap;

uniform sampler2D uSampler;
uniform sampler2D uSampler1;

uniform float uMin;
uniform float uMax;
uniform float uThreshold1;
uniform float uThreshold2;
uniform float uAlpha2;

varying vec2 vTextureCoord;
varying vec4 vPosition;
varying vec3 normal;
varying vec3 color;

vec3 rainbowColorMap( in float value )
{
	value *= 5.0;
	vec3 color;
	if( value < 0.0 )
		color = vec3( 0.0, 0.0, 0.0 );
	else if( value < 1.0 )
		color = vec3( 0.0, value, 1.0 );
	else if( value < 2.0 )
		color = vec3( 0.0, 1.0, 2.0-value );
	else if( value < 3.0 )
		color =  vec3( value-2.0, 1.0, 0.0 );
	else if( value < 4.0 )
		color = vec3( 1.0, 4.0-value, 0.0 );
	else if( value <= 5.0 )
		color = vec3( 1.0, 0.0, value-4.0 );
	else
		color = vec3( 1.0, 0.0, 1.0 );
	return color;
}

vec3 redYellowColorMap( in float value )
{
	vec3 color = vec3(0);
	color.r = 1.0;
	color.g = value;
	return color;
}

vec3 blueLightblueColorMap( in float value )
{
	vec3 color = vec3(0);
	color.b = 1.0;
	color.g = value;
	return color;
}

void main(void) {
	
	vec4 fragmentColor = texture2D(uSampler, vec2(vTextureCoord.s, vTextureCoord.t));
	vec4 fragmentColor1 = texture2D(uSampler1, vec2(vTextureCoord.s, vTextureCoord.t));

	if ( length(normal) < 0.0) discard;
	if ( length(color) < 0.0) discard;
	
	// if present show secondary texture
	if ( length( fragmentColor1.rgb ) > 0.01 )
	{
		if ( uColorMap != 0 )
		{
			vec3 c = vec3(0.0);
			float val = fragmentColor1.r * ( uMax - uMin );
			if ( uColorMap == 3 )
			{
				val = ( val + uMin ) / uMax;
				val = val - uThreshold2;
				if ( val > 0.0 )
				{
					val = val / ( 1.0 - uThreshold2 );
					c = rainbowColorMap( fragmentColor1.r );
				}
			}
			else
			{
				if ( abs( val + uMin ) > 0.01 )
				{
					if ( val < uMin * -1.0 )
					{
						val = 1.0 - ( ( val ) / ( uMin * -1.0 ) );
						val = val - abs(uThreshold1);
						if ( val > 0.0 )
						{
							val = val / ( 1.0 - abs(uThreshold1) );
							if ( uColorMap == 1 )
								c = blueLightblueColorMap( val );
							else
								c = redYellowColorMap( val );
						}
					} 
					else
					{
						val = ( val + uMin ) / uMax;
						val = val - uThreshold2;
						if ( val > 0.0 )
						{
							val = val / ( 1.0 - uThreshold2 );
							if ( uColorMap == 1 )
								c = redYellowColorMap( val );
							else
								c = blueLightblueColorMap( val );
						}
					}
				}
			}
			if ( length(c) > 0.0001 )
			{
				fragmentColor = vec4(mix(fragmentColor.rgb, c, uAlpha2), 1.0 );
			}
		}
		else
		{
			fragmentColor = vec4(mix(fragmentColor.rgb, fragmentColor1.rgb, uAlpha2), 1.0 );
		}
	}
	
	// color texture, discard zero values
	if ( length( fragmentColor.rgb ) < 0.001 ) {
		discard;
	}
	
	gl_FragColor = vec4(fragmentColor.r, fragmentColor.g, fragmentColor.b, fragmentColor.a);
}