package com.mozu.measure

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.TrackingState
import kotlin.math.max
import kotlin.math.min

const val WEB_BASE = "https://your-mozu-host" // ← set this

/**
 * Collects tapped floor corners (metric, from ARCore hit-tests) and hands the
 * measured room to the MOZU web app via the /scan deep link.
 *
 * Integrate into Google's ARCore sample (samples/hello_ar_kotlin):
 *   • on each screen tap, call onTap(frame, x, y) with the MotionEvent coords;
 *   • render a marker at each corner using the sample's anchor rendering;
 *   • call handOff(context) from a "Done" button once there are >= 3 corners.
 *
 * This is the measurement + hand-off logic only — ARCore session setup and GL
 * rendering come from the sample. It is a scaffold; build it in Android Studio.
 */
class RoomMeasure {
    data class Corner(val x: Float, val z: Float) // metres, floor plane

    val corners = mutableListOf<Corner>()

    /** Hit-test a screen tap against detected planes; record a floor corner. */
    fun onTap(frame: Frame, xPx: Float, yPx: Float): Boolean {
        if (frame.camera.trackingState != TrackingState.TRACKING) return false
        for (hit in frame.hitTest(xPx, yPx)) {
            val trackable = hit.trackable
            if (trackable is Plane && trackable.isPoseInPolygon(hit.hitPose)) {
                val pose = hit.hitPose
                corners.add(Corner(pose.tx(), pose.tz()))
                return true
            }
        }
        return false
    }

    fun undo() { if (corners.isNotEmpty()) corners.removeAt(corners.size - 1) }
    fun clear() { corners.clear() }

    /** Open the MOZU configurator on the measured room (mm polygon). */
    fun handOff(context: Context, ceilingMm: Int = 2700) {
        if (corners.size < 3) return
        val poly = corners.joinToString(";") {
            "${(it.x * 1000).toInt()},${(it.z * 1000).toInt()}"
        }
        val url = "$WEB_BASE/scan?poly=$poly&h=$ceilingMm"
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    /** Rectangular fallback (bounding box, mm) instead of a polygon. */
    fun boundingDimsMm(): Triple<Int, Int, Int>? {
        if (corners.isEmpty()) return null
        var minX = Float.MAX_VALUE; var maxX = -Float.MAX_VALUE
        var minZ = Float.MAX_VALUE; var maxZ = -Float.MAX_VALUE
        for (c in corners) {
            minX = min(minX, c.x); maxX = max(maxX, c.x)
            minZ = min(minZ, c.z); maxZ = max(maxZ, c.z)
        }
        return Triple(((maxX - minX) * 1000).toInt(), ((maxZ - minZ) * 1000).toInt(), 2700)
    }
}
