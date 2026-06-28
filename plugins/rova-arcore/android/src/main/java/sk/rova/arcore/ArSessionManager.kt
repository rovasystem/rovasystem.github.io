package sk.rova.arcore

import android.app.Activity
import android.content.Context
import com.getcapacitor.JSObject
import com.google.ar.core.*
import com.google.ar.core.exceptions.*

class ArSessionManager(private val activity: Activity) {
    var session: Session? = null
        private set

    private var displayWidth = 0
    private var displayHeight = 0
    private var displayRotation = 0

    fun setDisplayGeometry(width: Int, height: Int, rotation: Int) {
        displayWidth = if (width > 0) width else 0
        displayHeight = if (height > 0) height else 0
        displayRotation = rotation
        applyDisplayGeometry()
    }

    private fun applyDisplayGeometry() {
        val s = session ?: return
        if (displayWidth <= 0 || displayHeight <= 0) return
        try {
            s.setDisplayGeometry(displayRotation, displayWidth, displayHeight)
        } catch (_: Exception) {
        }
    }

    fun start() {
        if (session != null) return
        val s = Session(activity)
        val config = Config(s).apply {
            planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
            updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
            focusMode = Config.FocusMode.AUTO
        }
        s.configure(config)
        session = s
        applyDisplayGeometry()
        s.resume()
    }

    fun stop() {
        session?.pause()
        session?.close()
        session = null
    }

    fun update(): Frame? {
        val s = session ?: return null
        return try {
            s.update()
        } catch (e: Exception) {
            null
        }
    }

    companion object {
        fun isSupported(context: Context): Boolean {
            return try {
                when (ArCoreApk.getInstance().checkAvailability(context)) {
                    ArCoreApk.Availability.SUPPORTED_INSTALLED,
                    ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD,
                    ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED -> true
                    else -> false
                }
            } catch (_: Exception) {
                false
            }
        }

        fun poseToJson(pose: Pose): JSObject {
            val t = pose.translation
            val q = pose.rotationQuaternion
            return JSObject().apply {
                put("tx", t[0].toDouble())
                put("ty", t[1].toDouble())
                put("tz", t[2].toDouble())
                put("qx", q[0].toDouble())
                put("qy", q[1].toDouble())
                put("qz", q[2].toDouble())
                put("qw", q[3].toDouble())
            }
        }

        fun jsonToPose(obj: JSObject): Pose {
            val t = floatArrayOf(
                obj.getDouble("tx")?.toFloat() ?: 0f,
                obj.getDouble("ty")?.toFloat() ?: 0f,
                obj.getDouble("tz")?.toFloat() ?: 0f
            )
            val q = floatArrayOf(
                obj.getDouble("qx")?.toFloat() ?: 0f,
                obj.getDouble("qy")?.toFloat() ?: 0f,
                obj.getDouble("qz")?.toFloat() ?: 0f,
                obj.getDouble("qw")?.toFloat() ?: 1f
            )
            return Pose(t, q)
        }

        fun planeToJson(plane: Plane, planeId: String): JSObject {
            val center = plane.centerPose
            val extent = plane.extentX to plane.extentZ
            return JSObject().apply {
                put("id", planeId)
                put("type", plane.type.name)
                put("center", poseToJson(center))
                put("extentX", extent.first.toDouble())
                put("extentZ", extent.second.toDouble())
            }
        }
    }
}
